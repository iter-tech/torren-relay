// Read-only module — reads Amazon's native #selected-work-sheet and renders
// our own collapsible segmented summary panel injected below the clicked load card.
// NO clicks on Amazon elements, NO booking, NO hiding or modifying the native sheet.

var PANEL_ID                  = 'ext-inline-panel';
var SHEET_SELECTOR            = '#selected-work-sheet';
var currentPanelCard          = null; // owned by showInlinePanel (set on success) and removeInlinePanel (clear)
var _fastBookStorageListener  = null; // storage.onChanged listener for Fast Book visibility — cleaned up in removeInlinePanel

// --- waitForSheet poller state (2026-07-30 fix) --------------------------------------
// waitForSheet() used to create a bare setInterval per call with no handle and no way to
// cancel it. Clicking card A then quickly card B left BOTH pollers alive; A's poller then
// saw the sheet fingerprint change — caused by B's sheet loading — treated that as "my
// sheet is ready", and rendered card A's panel from card B's sheet data. The dispatcher
// could then create a PAT post from the wrong load entirely.
//
// Three pieces of state, because cancelling an interval alone is not sufficient: a callback
// already queued on the event loop still runs after clearInterval().
//   _sheetPollInterval — handle of the in-flight run, so it can actually be cancelled.
//   _sheetPollToken    — monotonic run id. Every cancel/start bumps it; a tick whose captured
//                        token no longer matches is from a superseded run and must not fire.
//   _sheetPollCard     — the card element the in-flight run was started for, so a resolved
//                        poll can confirm it is still the card the dispatcher is waiting on.
var _sheetPollInterval = null;
var _sheetPollToken    = 0;
var _sheetPollCard     = null;

// Cancels any in-flight waitForSheet run and invalidates its queued callback.
// Safe to call at any time, including when nothing is polling.
function cancelSheetPoll() {
  if (_sheetPollInterval !== null) {
    logger.log('inlinePanel', 'cancelSheetPoll: cancelling in-flight sheet poll');
    clearInterval(_sheetPollInterval);
    _sheetPollInterval = null;
  }
  _sheetPollCard = null;
  // Bumped even when no interval was live: a tick that already fired and is sitting on the
  // event loop reads this token, so incrementing is what actually neutralizes it.
  _sheetPollToken++;
}

function injectPanelStyle() {
  if (document.getElementById('ext-inline-panel-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-inline-panel-style';
  style.textContent =
    '.ext-inline-panel{' +
      // width:100%+box-sizing:border-box — LAYOUT FIX (2026-07-20): the panel is inserted as
      // a sibling of the load card via cardElement.parentNode.insertBefore(...). Amazon's
      // load-list container appears to lay its children out via flex/grid; a block <div>
      // with no explicit width shrinks to its content's natural width in that context
      // instead of filling the row, which is what produced "collapsed to the left, ~half
      // width" — the table's own width:100%/table-layout:fixed (below) was always correct,
      // it just had a shrunken parent to be 100% of. box-sizing:border-box keeps the 1px
      // border from pushing total rendered width past the card's width.
      'width:100%;box-sizing:border-box;' +
      'border:1px solid var(--ext-n200);border-radius:4px;margin:0 0 12px 0;' +
      'font-family:Arial,sans-serif;font-size:13px;overflow:hidden;' +
      // FLOATING-CARDS SURFACE (2026-07-30): was var(--ext-surface) (white/card-colored) —
      // the panel is now the GREY SURFACE the individual cards (load header, each leg)
      // float on top of, not a card itself. #F1F3F5 per spec, not a token — see
      // content/nightMode.js for why no dark counterpart is needed (its existing
      // DK_OVERLAY background already serves the same "surface, one step below the
      // raised cards" role in the dark elevation ramp).
      'background:#F1F3F5;' +
    '}' +
    // AUDIT 2026-07-30 (Part B): the `.ext-inline-panel__header` and
    // `.ext-inline-panel__header .ext-payout` rules that used to sit here were REMOVED as
    // dead CSS. Neither class is ever assigned to any element anywhere in the codebase —
    // `buildPanelElement()` never creates a load-header element, so both rules matched
    // nothing. They were added speculatively on 2026-07-30 and already flagged as dead in
    // their own comment. Re-add them together with the element if a load header is ever
    // actually built.
    // LEG HEADER REDESIGN (2026-07-30, CSS-only — no HTML/JS changes; see CHANGELOG.md).
    // Was display:flex with margin-left:auto on .ext-seg-dist clustering everything from
    // "distance" onward at the right edge, leaving an empty gap in the middle on wide
    // cards. Now display:grid, with grid-template-columns DELIBERATELY matching
    // .ext-inline-panel__table's own 34%/18%/24%/24% column widths (see that rule below)
    // so each header item sits directly above its corresponding table column — this only
    // works because .ext-seg-header's own padding (10px 16px) and .ext-seg-body's padding
    // (0 16px 12px, below) give both the SAME horizontal inset, so their content boxes
    // (against which grid/percentage widths resolve) start at the same x-offset and have
    // the same width. The 5th, 24px track is genuinely extra — the table has no chevron
    // column — carved out of the last 24% via calc() so column 4's LEFT edge (where the
    // Loaded/Empty pill sits) still lines up with the table's Departure column, while the
    // chevron gets its own narrow trailing cell instead of overlapping it.
    // LEG HEADER COLOUR (2026-07-30, CSS-only): background flipped from a fixed dark navy
    // to a light grey-green-blue (var(--ext-leg-header-bg), see designTokens.js — renamed
    // from --ext-leg-navy since it's no longer navy). base `color` becomes the primary text
    // hex (#1F3A45) — everything that doesn't get its own explicit color below inherits
    // this instead of the old white. New 1px bottom border (#C4D2D6) per spec, separating
    // the header from the body/next card. No dark-mode work needed for either — see the
    // 2026-07-30 nightMode.js entry in CHANGELOG.md for why (background/border-color are
    // already covered by existing !important overrides there).
    '.ext-seg-header{' +
      'background:var(--ext-leg-header-bg);color:#1F3A45;padding:10px 16px;' +
      'border-bottom:1px solid #C4D2D6;' +
      'display:grid;grid-template-columns:34% 18% 24% calc(24% - 24px) 24px;' +
      'align-items:center;justify-items:start;column-gap:0;' +
      'font-size:12px;font-weight:600;letter-spacing:0.3px;cursor:pointer;user-select:none;' +
      // FLOATING CARD (2026-07-30): no shared per-leg wrapper exists in the DOM (see
      // CHANGELOG.md), so the header/body pair approximate one card independently, keyed
      // off the .ext-open class JS already toggles on both. width:100%+box-sizing:
      // border-box forces this to match .ext-seg-body's width exactly regardless of the
      // reported overflow's exact cause (unconfirmed without a browser — see report).
      // overflow:hidden clips this element's own content to its own rounded corners.
      // Collapsed (no .ext-open): this IS the whole visible card — full radius, the
      // card's shadow, and the gap before the next leg. .ext-open below overrides all
      // three once the body becomes the card's visible bottom half.
      'width:100%;box-sizing:border-box;overflow:hidden;' +
      'border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.10);margin-bottom:8px;' +
    '}' +
    '.ext-seg-header.ext-open{border-radius:8px 8px 0 0;box-shadow:none;margin-bottom:0;}' +
    // Last leg — no gap before the action bar, per spec ("no gap above it"). :has() is
    // Chrome 105+; this codebase already assumes Chrome 111+ elsewhere (networkObserver.js's
    // "world":"MAIN" content script), so it's safe here.
    '.ext-seg-header:not(:has(~ .ext-seg-header)){margin-bottom:0;}' +
    // ROUTE GROUP ALIGNMENT (2026-07-30, CSS-only — no HTML/JS changes). Was flex with a
    // flat 8px gap across all 5 children (badge/code/arrow/badge/code); a short code (e.g.
    // "OH") vs a long one ("GAHANNA, OH") shifted every element after it, so arrows landed
    // in different x-positions leg to leg. Now a 3-TRACK grid — 170px origin / 28px arrow /
    // 170px destination — with the 5 DOM children explicitly placed onto those 3 tracks so
    // two children can share one track (badge + code = one visual "cell"). This requires
    // `grid-row:1` on every child: without it, the grid auto-placement algorithm sees a
    // track already occupied (by the badge) and bumps the next same-track item (the code
    // span) onto a NEW row instead of layering it into the same cell — see the child rules
    // below. margin-left:24px on top of .ext-seg-header's own 16px padding = 40px total
    // inset from the card's left edge, per spec. column-gap:0 because the 170/28/170 widths
    // are exact — the internal badge↔code and arrow spacing comes from the children's own
    // margins/centering, not a track gap (see below).
    '.ext-seg-route{' +
      'display:grid;grid-template-columns:170px 28px 170px;column-gap:0;' +
      'align-items:center;min-width:0;margin-left:24px;' +
    '}' +
    '.ext-seg-route > *{grid-row:1;}' +
    // Origin/destination badges (.ext-stop-num) — both children share one class (see
    // buildPanelElement() in this file), so position (1st vs 4th child) is what
    // distinguishes them for grid placement; class is included too so this only matches if
    // BOTH the position AND the badge class line up, in case a sibling is ever reordered.
    // No justify-self needed: badge width is an explicit 18px (not auto), and a grid item
    // with a definite size in its axis resolves default 'stretch' as 'start' per spec — it
    // already sits at the cell's left edge.
    '.ext-seg-route > .ext-stop-num:nth-child(1){grid-column:1;}' +
    '.ext-seg-route > .ext-stop-num:nth-child(4){grid-column:3;}' +
    // Origin/destination code text — SAME grid-column as their badge (both occupy the same
    // 170px cell). Left at default justify-self:stretch (auto width), so each resolves to
    // exactly (170px cell − 26px margin) = 144px of definite, clipped width — that's what
    // makes overflow:hidden/ellipsis below actually trigger instead of just growing past
    // the cell. margin-left:26px = 18px badge + 8px gap, reproducing the old flex gap
    // without a wrapper element. Replaces the old overflow-wrap/word-break (multi-line
    // wrap) with single-line + ellipsis per spec ("GAHANNA, OH" truncates instead of
    // wrapping or pushing the arrow off its column).
    '.ext-route-origin{' +
      'grid-column:1;margin-left:26px;' +
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;' +
      'color:#1F3A45;font-weight:600;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;' +
    '}' +
    '.ext-route-dest{' +
      'grid-column:3;margin-left:26px;' +
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;' +
      'color:#1F3A45;font-weight:600;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;' +
    '}' +
    // Own 28px cell, centred — this (fixed track + justify-self:center) is what makes every
    // leg's arrow land in the same vertical line, the core ask of this task. Color changed
    // from muted-white (rgba(255,255,255,.55), for the old dark header) to a muted slate —
    // not spec'd explicitly for this element, inferred to match the secondary/connector
    // weight of the distance/duration text below; flagged in CHANGELOG.md as a judgment
    // call. Night mode is unaffected either way — already has its own DK_MUTED override.
    '.ext-route-arrow{' +
      'grid-column:2;justify-self:center;' +
      'font-size:1.15em;font-weight:700;color:#4A6570;' +
    '}' +
    // Own grid cell (column 2 of the OUTER 5-col header grid — no more margin-left:auto).
    // LEG HEADER COLOUR (2026-07-30): #4A6570 per spec (was rgba(255,255,255,.72), muted-
    // white for the old dark header).
    '.ext-seg-dist{color:#4A6570;font-size:11px;white-space:nowrap;}' +
    // Pill badges (STATUS BADGES, 2026-07-30) — .ext-seg-action (Live/Drop, column 3) and
    // .ext-seg-status (base for Loaded/Empty, column 4) share the same pill mechanics;
    // .ext-seg-loaded/.ext-seg-empty supply only background+text per variant. Exact colors
    // as specified — deliberately NOT theme tokens: a light pill on the dark header is the
    // intended look in both themes (content/nightMode.js overrides these explicitly for
    // dark mode — see that file).
    '.ext-seg-action{' +
      'font-size:11px;font-weight:600;white-space:nowrap;border-radius:9999px;' +
      'padding:2px 10px;background:#E1EFFE;color:#1E429F;' +
    '}' +
    '.ext-seg-status{' +
      'font-size:11px;font-weight:600;white-space:nowrap;border-radius:9999px;padding:2px 10px;' +
    '}' +
    '.ext-seg-loaded{background:#DEF7EC;color:#03543F;}' +
    '.ext-seg-empty{background:#F3F4F6;color:#374151;}' +
    // LEG HEADER COLOUR (2026-07-30): color:#4A6570 added per spec — was unset, relying on
    // inheriting .ext-seg-header's own `color` (white, then #1F3A45 now). Needs its own
    // nightMode.js override (added — see CHANGELOG.md) since this new explicit rule would
    // otherwise leak the light-mode hex into dark mode instead of inheriting DK_TEXT.
    '.ext-seg-header .ext-seg-arrow{' +
      'transition:transform .15s;text-align:center;justify-self:center;padding:0 4px;' +
      'color:#4A6570;' +
    '}' +
    '.ext-seg-header.ext-open .ext-seg-arrow{transform:rotate(180deg);}' +
    // 2026-07-31: RESTORED to #FFFFFF. #F5F5F5 was briefly applied here, but this is the
    // per-leg BODY (the surface behind each load's stop rows) and the dispatcher confirmed
    // the intended surface was the HEADER. The colour moved to var(--ext-leg-header-bg) in
    // utils/designTokens.js; this rule went back to what it was. Light mode only either way:
    // content/nightMode.js overrides this exact selector's background-color with
    // DK_HIGH !important (see its .ext-seg-body rule), so this hex is never exercised in
    // dark mode and nightMode.js needed no change.
    '.ext-seg-body{' +
      'display:none;background:#FFFFFF;padding:0 16px 12px;' +
      'width:100%;box-sizing:border-box;overflow:hidden;' +
    '}' +
    // Visible (expanded): this is the card's bottom half — bottom-only radius, the card's
    // shadow (only rendered here, not duplicated on the header, so the header/body seam
    // doesn't get a stray shadow line — see .ext-seg-header.ext-open above), and the gap
    // before the next leg (0 for the last leg — see the :has() rule below).
    '.ext-seg-body.ext-open{' +
      'display:block;border-radius:0 0 8px 8px;box-shadow:0 1px 3px rgba(0,0,0,.10);margin-bottom:8px;' +
    '}' +
    '.ext-seg-body.ext-open:not(:has(~ .ext-seg-body)){margin-bottom:0;}' +
    // display:table + width:100% MUST be !important here — Amazon has a global rule that
    // sets <table> to display:block on the page. A block-level table ignores width:100%
    // for its own internal layout (the browser builds an anonymous shrink-to-fit table
    // inside the block instead), which is the confirmed, browser-measured root cause of
    // this table rendering at ~40-45% of the card width with empty space on the right
    // (2026-07-20). Do NOT remove the !important — without it, Amazon's rule wins and the
    // table silently reverts to shrink-to-fit.
    '.ext-inline-panel__table{display:table !important;width:100% !important;table-layout:fixed;border-collapse:collapse;}' +
    // Column widths (CSS POLISH, 2026-07-20): was 40/20/20/20 — now Stop 34%, Equipment/Id
    // 18%, Arrival 24%, Departure 24%.
    '.ext-inline-panel__table th:nth-child(1),.ext-inline-panel__table td:nth-child(1){width:34%;}' +
    '.ext-inline-panel__table th:nth-child(2),.ext-inline-panel__table td:nth-child(2){width:18%;}' +
    '.ext-inline-panel__table th:nth-child(3),.ext-inline-panel__table td:nth-child(3){width:24%;}' +
    '.ext-inline-panel__table th:nth-child(4),.ext-inline-panel__table td:nth-child(4){width:24%;}' +
    '.ext-inline-panel__table th{' +
      // TYPOGRAPHY HIERARCHY (2026-07-30): exact spec values, not the neutral-scale
      // tokens — #6B7280/#F9FAFB/#E5E7EB are close to but not identical to
      // var(--ext-n500)/var(--ext-n100)/var(--ext-n200), and the ask was specific hex.
      // Dark mode is unaffected: content/nightMode.js's existing
      // `#ext-inline-panel thead th` rule already overrides all three with !important.
      'text-align:left;font-size:11px;color:#6B7280;font-weight:600;' +
      'text-transform:uppercase;letter-spacing:0.5px;' +
      'padding:6px 12px;background:#F9FAFB;vertical-align:middle;' +
      'border-bottom:1px solid #E5E7EB;' +
    '}' +
    '.ext-inline-panel__table td{' +
      // Data-row border now #F3F4F6 per spec (was var(--ext-n200)) — no vertical column
      // borders (none were ever added — "border-right REMOVED" from an earlier pass).
      'padding:8px 12px;border-bottom:1px solid #F3F4F6;vertical-align:middle;word-break:break-word;' +
    '}' +
    // Primary line (station code / city) — the <b> element built in buildSegmentTable().
    // No class on that element (tag selector, scoped to this table, is precise enough —
    // avoided touching buildSegmentTable() for a rule this simple). TYPOGRAPHY HIERARCHY
    // (2026-07-30): 13px/var(--ext-n700) → 15px/#111827 per spec.
    '.ext-inline-panel__table td b{font-weight:600;color:#111827;font-size:15px;}' +
    // Zebra striping (CSS POLISH, 2026-07-20): reuses var(--ext-n100) — the same subtle
    // tint already established for the header — rather than inventing a new shade, per
    // "existing CSS custom properties only". content/nightMode.js's existing
    // `tbody td{background-color:DK_HIGH !important}` would otherwise erase this in dark
    // mode (blanket !important on every cell); a matching dark-mode counterpart was added
    // there (reusing the panel's own existing DK_OVERLAY, not a new color) — see that file.
    '.ext-inline-panel__table tbody tr:nth-child(even) td{background:var(--ext-n100);}' +
    // Last-row radius per spec — the VISIBLE rounded bottom corners of an expanded leg
    // card actually come from .ext-seg-body.ext-open's own box-radius above (the table
    // sits inset by .ext-seg-body's 16px/12px padding, not flush against its edges, so the
    // table's own corners aren't what the card's silhouette shows). Included anyway,
    // literally as specified, so nothing regresses if that padding is ever reduced.
    '.ext-inline-panel__table tbody tr:last-child td:first-child{border-radius:0 0 0 8px;}' +
    '.ext-inline-panel__table tbody tr:last-child td:last-child{border-radius:0 0 8px 0;}' +
    '.ext-stop-num{' +
      'display:inline-flex;width:18px;height:18px;border-radius:50%;' +
      'background:var(--ext-accent-bg);color:var(--ext-accent-text);font-size:11px;' +
      'align-items:center;justify-content:center;margin-right:8px;' +
    '}' +
    // 2026-07-30: the `.ext-seg-route .ext-stop-num{margin-right:0}` override that used to
    // live here is REMOVED — it existed only to cancel the base 8px margin-right so it
    // wouldn't double up with the old flex `gap:8px`. Now that .ext-seg-route is a grid and
    // spacing comes from the code span's own margin-left (see .ext-route-origin/-dest
    // above), the badge's margin-right has no visual effect either way — kept it removed
    // rather than leaving dead CSS behind.
    // TYPOGRAPHY HIERARCHY (2026-07-30): 11px/var(--ext-n500) → 13px/400/#6B7280 per spec.
    '.ext-stop-addr{color:#6B7280;font-size:13px;font-weight:400;margin-top:2px;}' +
    '.ext-dot-loaded{' +
      'display:inline-block;width:11px;height:11px;border-radius:50%;' +
      'background:var(--ext-n900);margin-right:6px;vertical-align:middle;' +
    '}' +
    '.ext-dot-empty{' +
      'display:inline-block;width:11px;height:11px;border-radius:50%;' +
      'border:1.5px solid var(--ext-n900);margin-right:6px;vertical-align:middle;' +
    '}' +
    // ATTACHED TO LAST LEG CARD (2026-07-30): this is always .ext-inline-panel's last
    // child (appended once, after every segment — see buildPanelElement()), and the last
    // leg's header/body now have margin-bottom:0 (above), so there's no gap between them
    // and this bar already. width:100%+box-sizing:border-box, same reasoning as the
    // header/body width fix above. Only the BOTTOM corners round — this sits flush under
    // whatever leg card is above it, not floating as its own separate card.
    // NOTE (per instruction, not changed here): this bar's DOM presence/visibility is
    // controlled by JS render logic (showInlinePanel() rebuilds the whole panel on every
    // call), not by CSS — see CHANGELOG.md. Nothing in this rule affects that.
    // BOTTOM ACTION BAR (2026-07-30): horizontal padding dropped from 10px to 0 per spec —
    // the bar's outer box (background/border) was ALREADY width:100%/border-box (i.e.
    // already spanning the full card edge-to-edge before this change); the 10px was purely
    // a CONTENT inset, not a width shortfall. Bottom corners keep the card radius,
    // unchanged. Left inset for the icons themselves now comes from the first icon's own
    // margin-left (see .ext-action-bar > .ext-action-btn:first-child below), not from
    // wrapper padding — per spec, "icons keep their own internal padding." Vertical
    // padding (5px) is untouched.
    '.ext-action-bar{' +
      'border-top:1px solid #E5E7EB;padding:5px 0;' +
      'display:flex;gap:4px;background:var(--ext-n100);' +
      'width:100%;box-sizing:border-box;border-radius:0 0 8px 8px;' +
    '}' +
    // Only the FIRST icon needs an explicit offset — the rest already sit 4px apart via the
    // bar's own flex `gap`. Judgment call, flagged: the ask only specified the icons' LEFT
    // start position; with the wrapper's own right padding now also 0, the Fast Book button
    // (pushed to the far right via its own margin-left:auto) sits flush against the card's
    // right edge with zero gutter — previously it had the same 10px the icons had on the
    // left. Not addressed here since it wasn't asked for; flagged in CHANGELOG.md in case
    // symmetric spacing is wanted on that side too.
    '.ext-action-bar > .ext-action-btn:first-child{margin-left:16px;}' +
    '.ext-action-btn{' +
      'width:28px;height:28px;border:none;background:none;border-radius:4px;' +
      'cursor:pointer;color:var(--ext-n400);display:inline-flex;align-items:center;' +
      'justify-content:center;padding:0;transition:background .15s,color .15s;' +
    '}' +
    '.ext-action-btn:hover{background:var(--ext-n200);color:var(--ext-n900);}' +
    '.ext-action-btn:focus-visible{outline:2px solid var(--ext-accent);outline-offset:2px;}' +
    '.ext-action-btn svg{width:15px;height:15px;display:block;}' +
    '.ext-action-btn--fastbook{' +
      'width:auto;padding:0 8px;font-size:11px;font-weight:600;letter-spacing:0.02em;' +
      'margin-left:auto;' +
      'color:#ffffff;border:none;border-radius:4px;background:#2563eb;' +
    '}' +
    '.ext-action-btn--fastbook:hover{background:#1d4ed8;color:#ffffff;}' +
    '.ext-action-btn--fastbook:disabled{opacity:0.6;cursor:not-allowed;}';
  document.head.appendChild(style);
}

// Executes the two-step Fast Book sequence: click Amazon's Book button, then click Confirm.
// Triggered ONLY by user's explicit Fast Book button click (Click 4 in SAFETY.md).
// isForbiddenElement() is called before each Amazon DOM click per the binding safety rule.
function executeFastBook(sheetLoadId, fastBookBtn) {
  logger.log('inlinePanel', 'executeFastBook called', { loadId: sheetLoadId, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });

  if (fastBookBtn) {
    fastBookBtn.disabled = true;
    fastBookBtn.textContent = 'Booking...';
  }

  var sheet = document.querySelector(SHEET_SELECTOR);
  if (!sheet) {
    logger.error('inlinePanel', 'executeFastBook: sheet not found', { selector: SHEET_SELECTOR });
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return;
  }

  // Step 1: find Amazon's Book button
  var bookBtn = sheet.querySelector('#rlb-book-btn');
  if (!bookBtn) {
    // Fallback: first <button> in sheet with exact text "Book"
    var sheetBtns = sheet.querySelectorAll('button');
    for (var i = 0; i < sheetBtns.length; i++) {
      if (sheetBtns[i].textContent.trim() === 'Book') { bookBtn = sheetBtns[i]; break; }
    }
  }
  if (!bookBtn) {
    logger.error('inlinePanel', 'executeFastBook: Book button not found in sheet');
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return;
  }
  if (isForbiddenElement(bookBtn)) {
    logger.error('inlinePanel', 'executeFastBook: bookBtn matched FORBIDDEN_SELECTORS — aborting', { id: bookBtn.id });
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return;
  }

  logger.log('inlinePanel', 'executeFastBook: clicking Book button', { id: bookBtn.id, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });
  bookBtn.click();

  // Step 2: poll for Amazon's confirm dialog button and click it
  var MAX_WAIT_MS   = 5000;
  var POLL_MS       = 100;
  var elapsed       = 0;
  var pollInterval  = setInterval(function () {
    elapsed += POLL_MS;
    var confirmBtn = document.querySelector('#rlb-book-trip-confirm-booking-btn');
    if (!confirmBtn) {
      // Fallback: button with text "Book" inside any modal/overlay that appeared after step 1
      var allBtns = document.querySelectorAll('button');
      for (var j = 0; j < allBtns.length; j++) {
        var t = allBtns[j].textContent.trim();
        if (t === 'Book' || t === 'Confirm' || t === 'Confirm booking') { confirmBtn = allBtns[j]; break; }
      }
    }
    if (confirmBtn && confirmBtn !== bookBtn) {
      clearInterval(pollInterval);
      if (isForbiddenElement(confirmBtn)) {
        logger.error('inlinePanel', 'executeFastBook: confirmBtn matched FORBIDDEN_SELECTORS — aborting', { id: confirmBtn.id });
        if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
        return;
      }
      logger.log('inlinePanel', 'executeFastBook: clicking confirm button', { id: confirmBtn.id, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });
      confirmBtn.click();
      if (fastBookBtn) {
        fastBookBtn.textContent = 'Booked!';
      }
    } else if (elapsed >= MAX_WAIT_MS) {
      clearInterval(pollInterval);
      logger.error('inlinePanel', 'executeFastBook: confirm button not found within timeout', { elapsed: elapsed });
      if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    }
  }, POLL_MS);
}

// Returns a cheap string fingerprint of the currently open detail sheet.
// Composed of payout text, expander count, and first stop label — enough to detect
// when Amazon has replaced the previous card's sheet with the new card's sheet.
function sheetFingerprint(sheet) {
  var payoutEl    = sheet.querySelector('.css-6hcxnp');
  var payout      = payoutEl ? payoutEl.textContent : '';
  var expanders   = sheet.querySelectorAll('.load-expander').length;
  var firstNameEl = sheet.querySelector('.css-424exj');
  var firstName   = firstNameEl ? firstNameEl.textContent : '';
  return payout + '|' + expanders + '|' + firstName;
}

// Polls until Amazon's native sheet has rendered segments AND its fingerprint has changed
// from prevFingerprint (when provided — guards against reading the previous card's stale sheet).
// prevFingerprint is null/undefined when no sheet was open before clicking; in that case any
// sheet with .load-expander is accepted immediately.
// Hard timeout: 1500ms — callback fires regardless; downstream handles null/stale data.
//
// SINGLE-FLIGHT as of 2026-07-30 (see the _sheetPoll* comment at the top of this file for the
// bug this fixes). At most one poll run exists at a time: starting a run cancels any previous
// one, and three independent guards stop a superseded run from ever reaching `callback`:
//   1. token check at tick entry   — a superseded run stops polling immediately.
//   2. token check before callback — catches a tick already queued when the cancel landed.
//   3. card identity + DOM check   — the run's card must still be the one being waited on,
//      and still attached. (Detached is not merely stale: showInlinePanel() renders via
//      cardElement.parentNode.insertBefore, which already throws on a detached node today —
//      so this converts a caught exception into a deliberate, silent discard.)
// `card` is optional; when omitted only the token guards apply.
function waitForSheet(callback, prevFingerprint, card) {
  logger.log('inlinePanel', 'waitForSheet called', { hasPrevFingerprint: prevFingerprint != null });

  // Requirement 1: never leave a previous poller running alongside this one.
  cancelSheetPoll();

  var myToken = _sheetPollToken; // identity of THIS run (cancelSheetPoll just bumped it)
  _sheetPollCard = card || null;

  var POLL_MS = 50;
  var MAX_MS  = 1500;
  var elapsed = 0;

  _sheetPollInterval = setInterval(function () {
    // Guard 1 — a newer run (or a teardown) superseded us. Do not poll, do not fire.
    // The interval itself was already cleared by cancelSheetPoll; this is for the tick that
    // was mid-flight when that happened.
    if (myToken !== _sheetPollToken) return;

    elapsed += POLL_MS;
    var sheet       = document.querySelector(SHEET_SELECTOR);
    var hasExpander = sheet && sheet.querySelector('.load-expander');
    var ready;
    if (prevFingerprint == null) {
      ready = !!hasExpander;
    } else {
      ready = !!(hasExpander && sheetFingerprint(sheet) !== prevFingerprint);
    }

    if (ready || elapsed >= MAX_MS) {
      // Requirement 4: always clear on resolve OR timeout — no orphaned pollers either way.
      clearInterval(_sheetPollInterval);
      _sheetPollInterval = null;

      // Guard 2 — re-check after the work above, before committing to a render.
      if (myToken !== _sheetPollToken) {
        logger.log('inlinePanel', 'waitForSheet: run superseded — discarding result');
        return;
      }
      // Guard 3 — requirement 2. Silent discard: a superseded click is not an error.
      if (card && (_sheetPollCard !== card || !document.contains(card))) {
        logger.log('inlinePanel', 'waitForSheet: card no longer the one being waited on — discarding result', {
          stillCurrent: _sheetPollCard === card, inDom: document.contains(card)
        });
        _sheetPollCard = null;
        return;
      }

      _sheetPollCard = null;
      if (elapsed >= MAX_MS && !ready) {
        logger.warn('inlinePanel', 'waitForSheet: hard timeout reached — firing callback anyway', { elapsed: elapsed });
      }
      callback();
    }
  }, POLL_MS);
}

function parseStopBlock(block) {
  var addrContainer = block.querySelector('.css-w1kk5u');
  var name          = '';
  var addressLines  = [];

  if (addrContainer) {
    var paras = addrContainer.querySelectorAll('p');
    paras.forEach(function (p) {
      var bold = p.querySelector('b');
      if (bold) {
        name = bold.textContent.trim();
      }
      var text = p.textContent.trim();
      if (text) addressLines.push(text);
    });
    addressLines = addressLines.filter(function (line) { return line !== name; });
  }

  var address = addressLines.join(', ');

  var arrivalEl   = block.querySelector('.scheduled-arrival__time .scheduled-time');
  var departureEl = block.querySelector('.scheduled-departure__time .scheduled-time');
  var arrival     = arrivalEl   ? arrivalEl.textContent.trim()   : '';
  var departure   = departureEl ? departureEl.textContent.trim() : '';

  // Equipment text + load type — both extracted from the same .css-1cbogyo block
  // that contains "Trailer". Normalized text looks like: "Equipment/ID 53' Trailer Drop"
  var equipmentText = '';
  var loadType      = '';
  var equipEls      = block.querySelectorAll('.css-1cbogyo');
  equipEls.forEach(function (eq) {
    if (eq.textContent.indexOf('Trailer') !== -1) {
      var normalized   = eq.textContent.replace(/\s+/g, ' ').trim();
      var trailerMatch = normalized.match(/\d+'\s*Trailer/);
      equipmentText    = trailerMatch ? trailerMatch[0].trim() : '';
      var statusMatch  = normalized.match(/Trailer\s+(Live|Drop|Preloaded)/i);
      if (statusMatch) {
        var raw = statusMatch[1].toLowerCase();
        if      (raw === 'live')      loadType = 'Live';
        else if (raw === 'drop')      loadType = 'Drop';
        else if (raw === 'preloaded') loadType = 'Preloaded';
      }
    }
  });

  // Loaded flag — first matching circle icon only; classList.contains avoids substring match
  var loaded   = false;
  var dotIcons = block.querySelectorAll('i.fa-circle, i.fa-circle-o');
  for (var d = 0; d < dotIcons.length; d++) {
    var icon = dotIcons[d];
    if (icon.classList.contains('fa-circle-o')) {
      loaded = false;
    } else if (icon.classList.contains('fa-circle')) {
      loaded = true;
    }
    break;
  }

  return {
    num:           '',
    name:          name,
    address:       address,
    equipmentText: equipmentText,
    loadType:      loadType,
    loaded:        loaded,
    arrival:       arrival,
    departure:     departure
  };
}

function readSheetData() {
  try {
    var sheet = document.querySelector(SHEET_SELECTOR);
    if (!sheet) {
      logger.warn('inlinePanel', 'readSheetData: sheet not found', { selector: SHEET_SELECTOR });
      return null;
    }

    // Header summary — stopsCount + totalMiles
    var stopsCount    = '';
    var totalMiles    = '';
    var headerSummary = sheet.querySelector('.css-ntd8uw .css-1q48g4q');
    if (headerSummary) {
      var summaryPs = headerSummary.querySelectorAll('p');
      if (summaryPs[0]) stopsCount = summaryPs[0].textContent.trim();
      if (summaryPs[1]) totalMiles = summaryPs[1].textContent.trim();
    }

    // Payout
    var payoutEl = sheet.querySelector('.css-6hcxnp');
    var payout   = payoutEl ? payoutEl.textContent.trim() : null;

    // Segments — one per .load-expander
    var loadExpanders = sheet.querySelectorAll('.load-expander');

    // Selector-drift alarm: .load-expander is a non-hashed class (stable); its absence
    // while the sheet exists may indicate Amazon changed the DOM structure.
    if (loadExpanders.length === 0) {
      logger.warn('inlinePanel', 'SELECTOR DRIFT SUSPECTED: sheet present but no .load-expander found — Amazon may have rebuilt CSS classes or DOM structure');
    }

    var segments = [];

    loadExpanders.forEach(function (expander) {
      // Segment header (id="#expanded-header" is reused; query within this expander)
      var segHeaderEl = expander.querySelector('#expanded-header');
      var fromName    = '';
      var toName      = '';
      var miles       = '';

      if (segHeaderEl) {
        var stopLabels = segHeaderEl.querySelectorAll('.css-17jtd1r');
        if (stopLabels[0]) {
          var fn = stopLabels[0].querySelector('.css-424exj');
          fromName = fn ? fn.textContent.trim() : '';
        }
        if (stopLabels[1]) {
          var tn = stopLabels[1].querySelector('.css-424exj');
          toName = tn ? tn.textContent.trim() : '';
        }
        var milesEl = segHeaderEl.querySelector('.css-14f9df9');
        miles = milesEl ? milesEl.textContent.trim() : '';
      }

      var fromTo = fromName + ' → ' + toName;

      // Duration — extract token after first bullet if present
      var duration   = '';
      var durationEl = expander.querySelector('.css-gudqq2 .css-1cp4is8');
      if (durationEl) {
        var dText  = durationEl.textContent;
        var bullet = dText.indexOf('•');
        if (bullet !== -1) {
          duration = dText.slice(bullet + 1).trim().split('•')[0].trim();
        }
      }

      // Stops from expander-content
      var content = expander.querySelector('.expander-content');
      var stops   = [];
      if (content) {
        var stopBlocks = content.querySelectorAll('.css-zgauvq');
        stopBlocks.forEach(function (block) {
          var stop = parseStopBlock(block);
          if (!stop.address && !stop.arrival) return;
          stops.push(stop);
        });
      }

      // De-duplicate stops within this segment by arrival+departure time.
      // Fresh seen object per segment — no cross-segment dedup.
      var seen         = {};
      var dedupedStops = [];
      for (var s = 0; s < stops.length; s++) {
        var stop    = stops[s];
        var timeKey = stop.arrival + '|' + stop.departure;
        if (stop.arrival && stop.departure) {
          if (seen[timeKey]) continue;
          seen[timeKey] = true;
        }
        dedupedStops.push(stop);
      }

      // segment.loaded = true if ANY stop in dedupedStops is loaded
      var segLoaded = false;
      for (var k = 0; k < dedupedStops.length; k++) {
        if (dedupedStops[k].loaded) { segLoaded = true; break; }
      }

      // segment.loadType = loadType of the LAST stop (delivery reflects what happens at destination)
      var segLoadType = '';
      if (dedupedStops.length > 0) {
        segLoadType = dedupedStops[dedupedStops.length - 1].loadType || '';
      }

      segments.push({
        idLabel:  '',
        fromTo:   fromTo,
        miles:    miles,
        duration: duration,
        loadType: segLoadType,
        loaded:   segLoaded,
        price:    '',
        stops:    dedupedStops
      });
    });

    // Selector-drift alarm: if segments were found but every one has 0 stops AND
    // empty fromTo, all the hashed css- class selectors likely returned nothing.
    if (segments.length > 0) {
      var allSegmentsEmpty = segments.every(function (seg) {
        return seg.stops.length === 0 && seg.fromTo.trim() === '→';
      });
      if (allSegmentsEmpty) {
        logger.warn('inlinePanel', 'SELECTOR DRIFT SUSPECTED: sheet present but all hashed selectors returned empty — Amazon may have rebuilt CSS classes');
      }
    }

    // Assign global stop numbers using a cumulative counter.
    // Boundary stops (first stop of each non-first segment, n>0 && sn===0) share
    // the previous segment's last number — counter is NOT advanced for them.
    // Correct for segments with any stop count (old per-segment formula assumed exactly 2).
    // Example (3 segments × 2 stops → 1,2 / 2,3 / 3,4):
    //   seg 0: stops[0].num="1"  stops[1].num="2"
    //   seg 1: stops[0].num="2"  stops[1].num="3"   ← 2 shared with seg 0 end
    //   seg 2: stops[0].num="3"  stops[1].num="4"   ← 3 shared with seg 1 end
    var stopCounter = 1;
    for (var n = 0; n < segments.length; n++) {
      var segStops = segments[n].stops;
      for (var sn = 0; sn < segStops.length; sn++) {
        if (n > 0 && sn === 0) {
          // Boundary stop: shares the previous segment's last number (counter - 1).
          segStops[sn].num = String(stopCounter - 1);
        } else {
          segStops[sn].num = String(stopCounter);
          stopCounter++;
        }
      }
    }

    // Route = first segment from-name → last segment to-name
    var route = '';
    if (segments.length > 0) {
      var firstParts = segments[0].fromTo.split(' → ');
      var lastParts  = segments[segments.length - 1].fromTo.split(' → ');
      route = (firstParts[0] || '') + ' → ' + (lastParts[lastParts.length - 1] || '');
    }

    return {
      header: {
        route:      route,
        stopsCount: stopsCount,
        totalMiles: totalMiles,
        payout:     payout
      },
      segments: segments
    };

  } catch (e) {
    logger.error('inlinePanel', 'readSheetData failed', { error: e });
    return null;
  }
}

// Builds the stops <table> for a segment — shared by both single and multi rendering.
function buildSegmentTable(segment) {
  var table = document.createElement('table');
  table.className = 'ext-inline-panel__table';

  var thead   = document.createElement('thead');
  var headRow = document.createElement('tr');
  ['Stop', 'Equipment / Id', 'Arrival', 'Departure'].forEach(function (label) {
    var th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');

  segment.stops.forEach(function (stop) {
    var tr = document.createElement('tr');

    // td1 — optional stop-num + name + address
    var td1 = document.createElement('td');
    if (stop.num) {
      var numSpan = document.createElement('span');
      numSpan.className = 'ext-stop-num';
      numSpan.textContent = String(stop.num);
      td1.appendChild(numSpan);
    }
    var nameEl = document.createElement('b');
    nameEl.textContent = stop.name;
    var addrDiv = document.createElement('div');
    addrDiv.className = 'ext-stop-addr';
    addrDiv.textContent = stop.address;
    td1.appendChild(nameEl);
    td1.appendChild(addrDiv);

    // td2 — loaded dot + equipment text
    var td2 = document.createElement('td');
    var dot = document.createElement('span');
    dot.className = stop.loaded ? 'ext-dot-loaded' : 'ext-dot-empty';
    td2.appendChild(dot);
    td2.appendChild(document.createTextNode(stop.equipmentText));

    // td3 — arrival
    var td3 = document.createElement('td');
    td3.textContent = stop.arrival;

    // td4 — departure
    var td4 = document.createElement('td');
    td4.textContent = stop.departure;

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

// Swaps the action button icon to a green checkmark for ~1 s, then restores it.
// Called by captureCardToClipboard on success.
function flashActionSuccess(btn) {
  logger.log('inlinePanel', 'flashActionSuccess called');
  var original      = btn.innerHTML;
  var originalTitle = btn.getAttribute('title'); // null when attribute absent
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="#157347"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true"><path d="M2 8l4 4 8-8"/></svg>';
  btn.setAttribute('title', 'Copied!');
  setTimeout(function () {
    btn.innerHTML = original;
    // Restore title exactly: removeAttribute when the original had none, to avoid
    // setAttribute(title, null) writing the string "null".
    if (originalTitle === null) {
      btn.removeAttribute('title');
    } else {
      btn.setAttribute('title', originalTitle);
    }
  }, 1100);
}

// Captures cardElement to a PNG via html2canvas and writes it to the clipboard.
// btn is the camera button — used for the success flash.
// The click on btn is the required user gesture; no extra permission prompt fires
// when clipboardWrite is granted in manifest.json.
function captureCardToClipboard(cardElement, btn) {
  logger.log('inlinePanel', 'captureCardToClipboard called');
  html2canvas(cardElement, {
    scale:           window.devicePixelRatio || 1,
    useCORS:         true,
    allowTaint:      false,
    backgroundColor: '#ffffff',
    logging:         false
  }).then(function (canvas) {
    canvas.toBlob(function (blob) {
      if (!blob) {
        logger.error('inlinePanel', 'captureCardToClipboard: toBlob returned null');
        return;
      }
      navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]).then(function () {
        logger.log('inlinePanel', 'captureCardToClipboard: copied to clipboard OK');
        flashActionSuccess(btn);
      }).catch(function (e) {
        logger.error('inlinePanel', 'captureCardToClipboard: clipboard write failed', { error: e });
      });
    }, 'image/png');
  }).catch(function (e) {
    logger.error('inlinePanel', 'captureCardToClipboard: html2canvas failed', { error: e });
  });
}

// Collects unique stops in global order (boundary stops appear in adjacent segments),
// builds a Google Maps Directions URL, and opens it in a new tab.
function openRouteInMaps(data) {
  logger.log('inlinePanel', 'openRouteInMaps called');
  var allStops = [];
  var seen = {};
  data.segments.forEach(function (seg) {
    seg.stops.forEach(function (stop) {
      var key = stop.num || (stop.name + '|||' + stop.address);
      if (!seen[key]) {
        seen[key] = true;
        allStops.push(stop);
      }
    });
  });
  if (allStops.length < 2) {
    logger.warn('inlinePanel', 'openRouteInMaps: fewer than 2 unique stops', { count: allStops.length });
    return;
  }
  function stopLabel(stop) {
    var addr = stop.address ? stop.address.trim() : '';
    return addr ? (stop.name + ' ' + addr) : stop.name;
  }
  var origin      = encodeURIComponent(stopLabel(allStops[0]));
  var destination = encodeURIComponent(stopLabel(allStops[allStops.length - 1]));
  var url = 'https://www.google.com/maps/dir/?api=1' +
    '&origin='      + origin +
    '&destination=' + destination +
    '&travelmode=driving';
  if (allStops.length > 2) {
    var waypoints = allStops.slice(1, -1)
      .map(function (stop) { return encodeURIComponent(stopLabel(stop)); })
      .join('|');
    url += '&waypoints=' + waypoints;
  }
  logger.log('inlinePanel', 'openRouteInMaps: opening map', { stops: allStops.length });
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Builds the three-button icon row rendered at the bottom of every inline panel.
// Click handlers for wired buttons are attached by showInlinePanel(), not here.
function buildActionBar() {
  logger.log('inlinePanel', 'buildActionBar called');

  var bar = document.createElement('div');
  bar.className = 'ext-action-bar';
  bar.setAttribute('data-testid', 'ext-action-bar');

  // Icon definitions: [ testid, aria-label, svg-inner-html ]
  // SVGs are static markup (no page data), stroke-based 16×16, consistent with
  // popup.html icon style. innerHTML is safe here — no user/page data involved.
  var icons = [
    [
      'ext-action-camera',
      'Screenshot',
      '<path d="M1 6h2.5l1.5-2.5h6L12.5 6H15v8H1z"/>' +
      '<circle cx="8" cy="10" r="2.2"/>'
    ],
    [
      'ext-action-map',
      'Route map',
      '<path d="M8 14s-5-4.2-5-8a5 5 0 0 1 10 0c0 3.8-5 8-5 8z"/>' +
      '<circle cx="8" cy="6" r="1.6"/>'
    ],
    [
      'ext-action-post',
      'Create post',
      '<path d="M3 1.5h6.5L13 5v9.5H3z"/>' +
      '<path d="M9.5 1.5V5H13"/>' +
      '<line x1="6.2" y1="9.2" x2="9.8" y2="9.2"/>' +
      '<line x1="8" y1="7.4" x2="8" y2="11"/>'
    ]
  ];

  icons.forEach(function (def) {
    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-testid', def[0]);
    btn.setAttribute('aria-label', def[1]);
    btn.setAttribute('title', def[1]);
    btn.className = 'ext-action-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' + def[2] + '</svg>';
    bar.appendChild(btn);
  });

  // Fast Book button — text only, hidden until fastBookEnabled is confirmed
  var fastBookBtn = document.createElement('button');
  fastBookBtn.setAttribute('type', 'button');
  fastBookBtn.setAttribute('data-testid', 'ext-action-fastbook');
  fastBookBtn.setAttribute('aria-label', 'Fast Book — instantly book this load');
  fastBookBtn.setAttribute('title', 'Fast Book — instantly book this load');
  fastBookBtn.className = 'ext-action-btn ext-action-btn--fastbook';
  fastBookBtn.textContent = 'Fast Book';
  fastBookBtn.style.display = 'none';
  bar.appendChild(fastBookBtn);

  return bar;
}

function buildPanelElement(data) {
  var panel = document.createElement('div');
  panel.className = 'ext-inline-panel';

  var multi = data.segments.length > 1;

  data.segments.forEach(function (segment, i) {
    if (multi) {
      // Two or more segments — collapsible grey header, body collapsed by default
      var segHeader = document.createElement('div');
      segHeader.className = 'ext-seg-header';

      // Route group — badge/code/arrow/badge/code all as direct children of ONE flex
      // container (.ext-seg-route), so they read as a single group at the left instead of
      // the badge sitting in its own separate grid column, far from its code (CSS POLISH,
      // 2026-07-20). Previously the origin badge lived in a separate `.ext-seg-title`
      // element/grid column; that element no longer exists.
      var fromToSpan = document.createElement('span');
      fromToSpan.className = 'ext-seg-route';

      var routeParts = segment.fromTo.split(' → ');
      var originText = routeParts[0] || '';
      var destText   = routeParts.length > 1 ? routeParts.slice(1).join(' → ') : '';

      // Use stops[0].num when stops exist; fall back to formula only when stops are empty.
      var originNum   = segment.stops.length > 0 ? segment.stops[0].num : String(i + 1);
      var originNumEl = document.createElement('span');
      originNumEl.className  = 'ext-stop-num';
      originNumEl.textContent = originNum;

      var originEl = document.createElement('span');
      originEl.className  = 'ext-route-origin';
      originEl.textContent = originText;

      var routeArrowEl = document.createElement('span');
      routeArrowEl.className  = 'ext-route-arrow';
      routeArrowEl.textContent = '→';

      // Use last stop's num when stops exist; fall back to formula only when stops are empty.
      var destNum   = segment.stops.length > 0
        ? segment.stops[segment.stops.length - 1].num
        : String(i + 2);
      var destNumEl = document.createElement('span');
      destNumEl.className  = 'ext-stop-num';
      destNumEl.textContent = destNum;

      var destEl = document.createElement('span');
      destEl.className  = 'ext-route-dest';
      destEl.textContent = destText;

      fromToSpan.appendChild(originNumEl);
      fromToSpan.appendChild(originEl);
      fromToSpan.appendChild(routeArrowEl);
      fromToSpan.appendChild(destNumEl);
      fromToSpan.appendChild(destEl);

      // Distance · duration — muted secondary
      var milesSpan = document.createElement('span');
      milesSpan.className = 'ext-seg-dist';
      milesSpan.textContent = segment.duration
        ? segment.miles + ' · ' + segment.duration
        : segment.miles;

      // Action text (Drop/Live/Preloaded) — plain text; always emit span for grid
      var loadTypeSpan = document.createElement('span');
      loadTypeSpan.className = 'ext-seg-action';
      loadTypeSpan.textContent = segment.loadType || '';

      // Status text — plain text with subtle color; no pill/chip
      var loadedSpan = document.createElement('span');
      loadedSpan.className = 'ext-seg-status ' + (segment.loaded ? 'ext-seg-loaded' : 'ext-seg-empty');
      loadedSpan.textContent = segment.loaded ? 'Loaded' : 'Empty';

      var arrowSpan = document.createElement('span');
      arrowSpan.className  = 'ext-seg-arrow';
      arrowSpan.textContent = '⌄';

      segHeader.appendChild(fromToSpan);
      segHeader.appendChild(milesSpan);
      segHeader.appendChild(loadTypeSpan);
      segHeader.appendChild(loadedSpan);
      segHeader.appendChild(arrowSpan);

      var segBody = document.createElement('div');
      segBody.className = 'ext-seg-body'; // no ext-open — collapsed by default
      segBody.appendChild(buildSegmentTable(segment));

      // Toggle collapse — closure captures this header + body pair
      (function (hdr, body) {
        hdr.addEventListener('click', function () {
          hdr.classList.toggle('ext-open');
          body.classList.toggle('ext-open');
        });
      }(segHeader, segBody));

      panel.appendChild(segHeader);
      panel.appendChild(segBody);

    } else {
      // Single segment — table always visible, no accordion wrapper
      var wrapper = document.createElement('div');
      wrapper.appendChild(buildSegmentTable(segment));
      panel.appendChild(wrapper);
    }
  });

  panel.appendChild(buildActionBar());

  return panel;
}

// Resolves the live outermost card element for loadId at click time.
// Mirrors parseLoads() dedup: initManualToggle.closest() returns the INNERMOST matching
// ancestor, but parseLoads keeps only the OUTERMOST via allCards.filter(elB.contains(elA)).
// When Amazon nests div.wo-card-header--highlighted inside div.load-card, the captured
// cardElement is the inner node — it has div[id] but lacks .equipment-type-text /
// .wo-total_payout / .wo-card-header__components, so parseOneCard returns empty Phase 1.
// Selectors: div.load-card, div.load-card__selected — same pair as parseLoads querySelectorAll.
// div.wo-card-header--highlighted excluded: always an inner wrapper, never the outer container;
// parseLoads already drops it via the contains() filter.
function findLiveOutermostCard(loadId) {
  var idEl = document.getElementById(loadId);
  if (!idEl) return null;
  var card = idEl.closest('div.load-card, div.load-card__selected');
  if (!card) return null;
  var outer = card;
  var p = card.parentElement;
  while (p) {
    var candidate = p.closest('div.load-card, div.load-card__selected');
    if (!candidate) break;
    outer = candidate;
    p = candidate.parentElement;
  }
  return outer;
}

function showInlinePanel(cardElement) {
  logger.log('inlinePanel', 'showInlinePanel called');

  injectPanelStyle();

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  var data = readSheetData();
  if (!data || !data.segments || data.segments.length === 0) {
    logger.warn('inlinePanel', 'no sheet data to render');
    return false;
  }

  // Phase 2 merge — store the detail struct under this load's loadId.
  // readSheetData() does not know the loadId; resolve it the same way parseOneCard() does.
  var sheetLoadIdEl = cardElement.querySelector('div[id]');
  var sheetLoadId   = sheetLoadIdEl ? sheetLoadIdEl.id : null;
  if (sheetLoadId) {
    loadStore.mergeLoadUnit(sheetLoadId, { detail: data });
  }

  var panel = buildPanelElement(data);
  panel.id  = PANEL_ID;

  // Wire ext-action-camera: click → screenshot this card → copy PNG to clipboard.
  // Handler attached here because cardElement is only available in showInlinePanel().
  // This is our own extension UI element, not Amazon DOM — exempt from the 3-click-site rule.
  var cameraBtn = panel.querySelector('[data-testid="ext-action-camera"]');
  if (cameraBtn) {
    cameraBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-camera clicked');
      captureCardToClipboard(cardElement, cameraBtn);
    });
  }

  var mapBtn = panel.querySelector('[data-testid="ext-action-map"]');
  if (mapBtn) {
    mapBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-map clicked');
      openRouteInMaps(data);
    });
  }

  var postBtn = panel.querySelector('[data-testid="ext-action-post"]');
  if (postBtn) {
    postBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-post clicked');
      // On-demand Phase 1 parse: covers the case where the refresh loop was never started
      // and parseLoads() has therefore never run for this card.
      // parseOneCard() is standalone-safe — no effect on knownLoadIds, detection pipeline,
      // tabState, highlight, or sound. Replicates exactly the mergeLoadUnit call in parseLoads().
      try {
        var storedUnit  = sheetLoadId ? loadStore.getLoadUnit(sheetLoadId) : null;
        var needsPhase1 = !storedUnit || !storedUnit.equipment ||
                          !storedUnit.boardStops || storedUnit.boardStops.length === 0;
        if (needsPhase1 && sheetLoadId) {
          var liveCard    = findLiveOutermostCard(sheetLoadId);
          var usedLive    = !!liveCard;
          var sameNode    = liveCard === cardElement;
          var parseTarget = liveCard || cardElement;
          logger.log('inlinePanel', 'ext-action-post: Phase 1 missing — parsing card on demand', { loadId: sheetLoadId, usedLive: usedLive, sameNode: sameNode });
          var parsed = parseOneCard(parseTarget);
          loadStore.mergeLoadUnit(parsed.loadId || sheetLoadId, {
            payout:          parsed.payout,
            pricePerMile:    parsed.pricePerMile,
            distance:        parsed.distance,
            duration:        parsed.duration,
            boardStops:      parsed.stops,
            equipment:       parsed.equipment,
            trailerLetter:   parsed.trailerLetter,
            loadingType:     parsed.loadingType,
            deadhead:        parsed.deadhead,
            tag:             parsed.tag,
            specialServices: parsed.specialServices,
          });
          if (!parsed.equipment || !parsed.stops || parsed.stops.length === 0) {
            logger.error('inlinePanel', 'ext-action-post: on-demand parse yielded empty Phase 1 — card layout may have changed', {
              loadId:       sheetLoadId,
              outerHTMLLen: parseTarget ? parseTarget.outerHTML.length : 0,
              equipment:    parsed.equipment,
              stopsCount:   parsed.stops ? parsed.stops.length : 0,
              usedLive:     usedLive,
              sameNode:     sameNode,
            });
          }
        }
      } catch (e) {
        logger.error('inlinePanel', 'ext-action-post: on-demand Phase 1 parse failed', { error: e, loadId: sheetLoadId });
      }
      openPostModal(sheetLoadId);
    });
  }

  // Wire ext-action-fastbook: read storage for initial visibility, attach click handler,
  // and keep visibility in sync with popup toggle changes via chrome.storage.onChanged.
  if (_fastBookStorageListener) {
    chrome.storage.onChanged.removeListener(_fastBookStorageListener);
    _fastBookStorageListener = null;
  }

  var fastBookBtn = panel.querySelector('[data-testid="ext-action-fastbook"]');
  if (fastBookBtn) {
    chrome.storage.local.get('fastBookEnabled', function (data) {
      fastBookBtn.style.display = data.fastBookEnabled === true ? '' : 'none';
    });

    fastBookBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-fastbook clicked', { loadId: sheetLoadId });
      executeFastBook(sheetLoadId, fastBookBtn);
    });

    _fastBookStorageListener = function (changes, area) {
      if (area !== 'local' || changes.fastBookEnabled === undefined) return;
      fastBookBtn.style.display = changes.fastBookEnabled.newValue === true ? '' : 'none';
      if (changes.fastBookEnabled.newValue !== true) {
        fastBookBtn.disabled = false;
        fastBookBtn.textContent = 'Fast Book';
      }
    };
    chrome.storage.onChanged.addListener(_fastBookStorageListener);
  }

  cardElement.parentNode.insertBefore(panel, cardElement.nextSibling);

  // Update currentPanelCard here so both auto-open and manual paths stay in sync.
  // Ownership is here (set) and in removeInlinePanel (clear); initManualToggle no longer touches it.
  currentPanelCard = cardElement;

  logger.log('inlinePanel', 'panel rendered', { segments: data.segments.length });
  return true;
}

function removeInlinePanel() {
  // Requirement 3 (2026-07-30): a sheet poll must never outlive teardown. This one call site
  // covers every path that matters — content.js's clearPipelineDom() calls removeInlinePanel(),
  // and clearPipelineDom() is itself called by deactivateExtensionUI() (logout / auth-gate
  // close) AND by every shouldContinue()-failing bail-out checkpoint in runDetectionPipeline.
  // Also covers the toggle-off path below. Without this, a poll started just before logout
  // would still fire and re-create the panel after everything had been torn down.
  cancelSheetPoll();

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();
  currentPanelCard = null;
  if (_fastBookStorageListener) {
    chrome.storage.onChanged.removeListener(_fastBookStorageListener);
    _fastBookStorageListener = null;
  }
}

function initManualToggle() {
  if (window.__extManualToggleInit) return;
  window.__extManualToggleInit = true;

  document.addEventListener('click', function (ev) {
    var card = ev.target.closest('div.load-card, div.load-card__selected');
    if (!card) return;

    // Login gate (2026-07-20): this listener is registered once and never removed
    // (window.__extManualToggleInit guard above), so it must gate itself on every click
    // rather than relying on being un-registered on logout. isAuthGateActiveSync() reads
    // utils/authGate.js's last-known state synchronously — kept in sync live by
    // onAuthGateChange, not just at page load.
    if (typeof isAuthGateActiveSync === 'function' && !isAuthGateActiveSync()) return;

    // SAFETY: never react to clicks on forbidden elements (Book buttons etc.)
    if (isForbiddenElement(ev.target)) return;

    // Toggle off: clicking the same card while its panel is open removes it.
    // Works for both manually-opened and auto-opened panels (currentPanelCard is now
    // set by showInlinePanel, not just by this handler).
    if (currentPanelCard === card && document.getElementById(PANEL_ID)) {
      removeInlinePanel();
      return;
    }

    // STOP THE LOOP HERE — synchronously, at the click, NOT inside the waitForSheet
    // callback below.
    //
    // 2026-07-31 REGRESSION FIX. This call used to live in that callback. waitForSheet's
    // guard 3 (added 2026-07-30 with the single-flight fix, to stop card A's poll rendering
    // card B's sheet) discards the whole run when the clicked card is no longer attached:
    //     if (card && (_sheetPollCard !== card || !document.contains(card))) return;
    // While auto-refresh is RUNNING, refreshNow() makes Amazon re-render the load list, which
    // detaches the very card the dispatcher just clicked — inside guard 3's own 50-1500ms
    // poll window. The run was then discarded and the stop never executed, so the loop kept
    // refreshing until the dispatcher stopped it by hand. The faster the refresh interval,
    // the more reliably it happened.
    //
    // Stopping belongs at the click, not at the render: the dispatcher clicked a load to
    // review it, and that intent does not depend on whether Amazon's sheet finished opening,
    // whether the poll timed out, or whether React happened to replace the card node. Guard 3
    // still governs the RENDER below, which is the only thing it was ever meant to protect —
    // rendering the wrong card's data is a real hazard; stopping the loop is not.
    //
    // Still exactly ONE stop call in this file (no second call was added at another layer),
    // it simply runs at the correct moment now. Nothing auto-resumes: the loop stays stopped
    // until the dispatcher restarts it from the sidebar.
    try {
      tabState.set('running', false);
      logger.log('inlinePanel', 'manual card open — stopping loop for dispatcher review');
    } catch (e) {
      logger.error('inlinePanel', 'tabState stop failed on manual card open', { error: e });
    }

    // Toggle on: capture a fingerprint of the currently open sheet BEFORE polling starts.
    // waitForSheet will only fire the callback once the sheet has changed (i.e., Amazon has
    // replaced the previous card's sheet with the new one), preventing stale-sheet renders.
    var prevSheet       = document.querySelector(SHEET_SELECTOR);
    var prevFingerprint = prevSheet ? sheetFingerprint(prevSheet) : null;

    waitForSheet(function () {
      try {
        showInlinePanel(card);
        // currentPanelCard ownership has moved to showInlinePanel — no assignment here
      } catch (e) {
        logger.warn('inlinePanel', 'manual toggle render failed', { error: e });
      }
    }, prevFingerprint, card); // `card` tags this run — see waitForSheet's guard 3
  });

  logger.log('inlinePanel', 'manual toggle initialized');
}

// Expose for manual console testing only — NOT called automatically.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.showPanel        = function () {
  var c = document.querySelector('div.load-card__selected, div.load-card');
  return showInlinePanel(c);
};
window.__EXT_DEBUG.removePanel      = removeInlinePanel;
window.__EXT_DEBUG.initManualToggle = initManualToggle;
