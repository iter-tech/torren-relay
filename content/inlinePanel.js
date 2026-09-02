// Our own collapsible segmented summary panel, injected below a load card.
//
// ── STAGE A, 2026-08-14: THE SCRAPE PATH IS GONE ────────────────────────────────────────────
//
// This module used to click nothing but WAIT for Amazon's native #selected-work-sheet to open,
// then read the panel's contents out of it with a wall of `.css-<hash>` selectors. All of that
// is removed — waitForSheet(), cancelSheetPoll(), sheetFingerprint(), readSheetData(),
// parseStopBlock(), and every hashed selector they carried (338 lines).
//
// ⚠ THIS STAGE DELIBERATELY LEAVES NO PANEL. Rendering returns in Stage B (PLAN §29b) from the
// captured API records, keyed by load id. Everything the dispatcher relies on is untouched:
// Amazon's own detail sheet still opens on every card click (we never intercepted it — this
// listener has no preventDefault and no stopPropagation), the loop still stops when he opens a
// load, START/STOP, the auto-switch, filtering, detection and the alert are all unaffected.
//
// NO clicks on Amazon elements from this module except Fast Book's own, NO hiding or modifying
// the native sheet.

var PANEL_ID                  = 'ext-inline-panel';
// KEPT FOR FAST BOOK, deliberately. Stage A's brief listed this for removal, but
// executeFastBook() reads Amazon's live sheet through it to find the Book button — removing it
// would break Fast Book, which is a dependency to preserve. It is a stable id selector, not one
// of the hashed classes the scrape used. See the report for the full dependency trace.
var SHEET_SELECTOR            = '#selected-work-sheet';
// Amazon's marker for the card whose detail sheet is open. Measured 2026-08-27: a semantic
// class, NOT a css-<hash> one, and the open card carries exactly one bare UUID. This is the
// ONLY source of the open load id — the sheet itself does not carry it. See AMAZON_SELECTORS.md.
var SELECTED_CARD_SELECTOR    = '.load-card__selected';
// One cent. The record keeps a full float (e.g. 668.1707937465877) and the board prints it
// rounded ("$668.17"), so an exact comparison would fail on every load.
var PAYOUT_TOLERANCE          = 0.01;
var currentPanelCard          = null; // owned by showInlinePanel (set on success) and removeInlinePanel (clear)
var _fastBookStorageListener  = null; // storage.onChanged listener for Fast Book visibility — cleaned up in removeInlinePanel
// ⚠ THE CONFIRM POLL'S HANDLE, MODULE-LEVEL ON PURPOSE (2026-08-27, BACKLOG 0al item 3).
// It used to be a local inside executeFastBook(), which nothing outside could clear — so a
// 5-second poll that clicks a confirm button OUTLIVED the panel being torn down. On a booking
// path that is the wrong kind of survivor. removeInlinePanel() now clears it.
var _fastBookPollInterval     = null;
// ⚠ REHEARSAL ONLY (2026-08-27). Set by __EXT_DEBUG.fastBookForceMismatch() and cleared the
// instant it is read, so it survives exactly ONE press and never a refresh. It is false in
// every ordinary press — nothing in the product can set it, only the console helper — so
// pressing Fast Book without invoking that helper behaves exactly as it did before it existed.
var _fastBookForceMismatchOnce = false;


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
      // TEXT TREATMENT (2026-08-17). The header read as a faint caption rather than a heading,
      // and the measurement said why: it was 12px/600 while the rows it heads are 13px — a
      // heading SMALLER than its own content. Now 15px/700, so it is unambiguously the larger,
      // heavier element in its block.
      //
      // ⚠ CONTRAST WAS NEVER THE PROBLEM: the old #1F3A45 on --ext-leg-header-bg (#F5F5F5)
      // already measured 11.01:1. It is replaced by --ext-n900 anyway, which measures 15.79:1
      // and removes a hardcoded hex in favour of a token. The BACKGROUND token is untouched, as
      // specified.
      'background:var(--ext-leg-header-bg);color:var(--ext-n900);padding:10px 16px;' +
      'border-bottom:1px solid #C4D2D6;' +
      'display:grid;grid-template-columns:34% 18% 24% calc(24% - 24px) 24px;' +
      'align-items:center;justify-items:start;column-gap:0;' +
      'font-size:15px;font-weight:700;letter-spacing:0.3px;cursor:pointer;user-select:none;' +
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
    // ⚠ THESE ARE THE HEADER'S ACTUAL TEXT — the "MDT4 → LEWISTOWN, PA" route — and at 11px they
    // were SMALLER than the 13px rows beneath them, which is most of why the header read as a
    // caption. Raising .ext-seg-header alone would have left a 15px container holding 11px
    // content. 13px matches the rows and, with weight 700, sits clearly above them; the existing
    // ellipsis still protects the fixed grid track from a long city name.
    //
    // Colour moved off the #1F3A45 literal onto --ext-n900 so it matches the header text exactly
    // (15.79:1) instead of being a second, lighter tone. Night mode already overrides both
    // selectors (nightMode.js:157-158), so this touches light mode only.
    '.ext-route-origin{' +
      'grid-column:1;margin-left:26px;' +
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:13px;' +
      'color:var(--ext-n900);font-weight:700;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;' +
    '}' +
    '.ext-route-dest{' +
      'grid-column:3;margin-left:26px;' +
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:13px;' +
      'color:var(--ext-n900);font-weight:700;' +
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
      // SIDE INSET REMOVED (2026-08-17): was `padding:0 16px 12px`, and that 16px on each side
      // was the entire cause of the expanded table sitting inset. This element contains NOTHING
      // BUT the stop table (segBody.appendChild(buildSegmentTable(segment)) is its only child),
      // so dropping the horizontal padding moves the table and nothing else.
      //
      // The selector IS shared with nightMode.js, which sets `background-color` on it — checked
      // before changing this, and padding does not collide with that. The bottom 12px stays: it
      // is the gap above the card's rounded bottom edge, not part of the inset.
      'display:none;background:#FFFFFF;padding:0 0 12px;' +
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
      // U3 (2026-08-20): EVERY stop row is explicitly white. The zebra rule was already deleted
      // in 2026-08-17, but the cells still declared NO background at all, so the panel's own
      // #F1F3F5 surface showed through and the lower rows read as a grey band. Stating it here
      // makes a row's background independent of whatever sits behind the table.
      'background:var(--ext-surface);' +
    '}' +
    // Primary line (station code / city) — the <b> element built in buildSegmentTable().
    // No class on that element (tag selector, scoped to this table, is precise enough —
    // avoided touching buildSegmentTable() for a rule this simple). TYPOGRAPHY HIERARCHY
    // (2026-07-30): 13px/var(--ext-n700) → 15px/#111827 per spec.
    '.ext-inline-panel__table td b{font-weight:600;color:#111827;font-size:15px;}' +
    // ZEBRA STRIPING REMOVED 2026-08-17. Every row is now the same white, per Ihor. The rule
    // that used to sit here tinted even rows with var(--ext-n100); it is DELETED rather than
    // overridden by a second rule, so there is one source of truth for a row's background.
    // Its dark-mode counterpart in nightMode.js went with it — leaving that would have kept
    // night mode striped. Row SEPARATORS are untouched: they come from td{border-bottom}.
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
// `dryRun` (2026-08-27) is a REHEARSAL flag, and its ONLY effect is to return immediately before
// the Book click — so the two clicks and the confirm poll are skipped. Every check above that
// point runs unchanged: same sheet lookup, same Book-button lookup, same forbidden test, same
// identity comparison. Nothing is reimplemented, which is the entire point — a rehearsal that
// ran different code would prove nothing about the real path.
//
// Returns a short outcome string so the console helpers can report what happened without
// re-deriving it. No caller in the product reads the return value.
function executeFastBook(sheetLoadId, fastBookBtn, dryRun) {
  logger.log('inlinePanel', 'executeFastBook called', { loadId: sheetLoadId, dryRun: !!dryRun, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });

  // 🔑 GATE 3 of 3 (2026-08-27) — THE LAST WORD, AND DELIBERATELY THE FIRST STATEMENT.
  // It sits ABOVE every DOM read, above the rehearsal flag, and above the sheet lookup, so there
  // is no path through this function that touches the page before it. A direct __EXT_DEBUG call,
  // a hand-added button, a listener left over from a previous panel — none of them reaches a
  // click while this is false. `typeof` guard so a context missing constants.js fails CLOSED.
  if (typeof FAST_BOOK_ENABLED === 'undefined' || FAST_BOOK_ENABLED !== true) {
    logger.warn('inlinePanel', 'executeFastBook: REFUSED — Fast Book is disabled in this build ' +
      '(FAST_BOOK_ENABLED is false). No DOM was read and no click was sent.', {
        loadId: sheetLoadId, dryRun: !!dryRun
      });
    return 'disabled';
  }

  // REHEARSAL: corrupt the BOUND id only, for one press. The sheet is untouched, Amazon's DOM is
  // untouched, and the comparison below is the real one — it simply now has two ids that differ.
  if (_fastBookForceMismatchOnce) {
    _fastBookForceMismatchOnce = false;
    var forcedFrom = sheetLoadId;
    sheetLoadId = 'FORCED-MISMATCH-' + String(sheetLoadId);
    logger.warn('inlinePanel', 'executeFastBook: REHEARSAL — the bound load id was deliberately ' +
      'corrupted for this ONE press, so the identity check must abort', {
        realBoundId: forcedFrom, corruptedTo: sheetLoadId
      });
  }

  if (fastBookBtn) {
    fastBookBtn.disabled = true;
    fastBookBtn.textContent = 'Booking...';
  }

  var sheet = document.querySelector(SHEET_SELECTOR);
  if (!sheet) {
    logger.error('inlinePanel', 'executeFastBook: sheet not found', { selector: SHEET_SELECTOR });
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return 'no-sheet';
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
    return 'no-book-button';
  }
  if (isForbiddenElement(bookBtn)) {
    logger.error('inlinePanel', 'executeFastBook: bookBtn matched FORBIDDEN_SELECTORS — aborting', { id: bookBtn.id });
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return 'forbidden';
  }

  // ── 🔑 IDENTITY CHECK — THE LOAD IN THE SHEET MUST BE THE LOAD THIS BUTTON IS BOUND TO ────
  //
  // BACKLOG 0al, 2026-08-27. Before this, sheetLoadId was passed in and used for ONE thing: a
  // log line. Nothing compared it to anything, so Fast Book clicked Book on whatever load
  // happened to be open in #selected-work-sheet. Nothing would have noticed or reported a
  // divergence — including the dispatcher, who would have seen a successful booking.
  //
  // ⚠ FAIL CLOSED, AND IT IS THE POINT OF THE CHECK. Three separate ways to abort:
  //   - the ids differ
  //   - the BOUND id is missing        (the panel could not read its card)
  //   - the SHEET id is missing        (no sheet, no UUID in it, or it could not be read)
  // An absent id NEVER compares equal and is never treated as "probably fine". This is the one
  // place in the extension that spends the dispatcher's money.
  //
  // ⚠ STRICT EQUALITY ON THE UUID STRING, no normalising. Both ids are read from the .id DOM
  // property of Amazon's own markup, so a casing difference would mean the two sides disagree
  // about something — which is exactly when this must abort rather than paper over it.
  var sheetOpen = sheetOpenLoadId();
  var openId    = sheetOpen ? sheetOpen.id : null;
  var openWhy   = sheetOpen ? sheetOpen.reason : 'error';

  // A CHANGED AMAZON CLASS GETS ITS OWN, LOUDER ABORT. 'the marker is gone' and 'these are two
  // different loads' are completely different problems: the first blocks EVERY press until
  // someone re-measures the board, the second is the guard doing its job on one press. Giving
  // them the same wording is how a permanent block hides as a routine refusal — which is exactly
  // what happened when this read the sheet for an id the sheet never carried.
  if (openWhy === 'no-selected-card') {
    logger.error('inlinePanel', 'executeFastBook: ABORTED — THE SELECTED-CARD MARKER WAS NOT ' +
      'FOUND ON THE BOARD, so the open load cannot be identified at all. This is NOT a mismatch ' +
      'between two loads: nothing matches the marker, which is what a changed Amazon class looks ' +
      'like. EVERY Fast Book press will block until the marker is re-measured. NO booking click ' +
      'was sent.', {
        selector: SELECTED_CARD_SELECTOR,
        boundLoadId: sheetLoadId || '(missing)',
        sheetPresent: !!(sheetOpen && sheetOpen.present),
        intent: ALLOWED_CLICK_INTENTS.FAST_BOOK
      });
    if (fastBookBtn) {
      fastBookBtn.disabled = true;
      fastBookBtn.textContent = 'Blocked — cannot identify open load';
      fastBookBtn.setAttribute('title',
        'Fast Book was blocked. The extension could not tell which load Amazon has open, ' +
        'because the marker it reads is no longer on the page. Booking is disabled until this ' +
        'is fixed — this is an extension-side problem, not something reopening the load will ' +
        'clear. Please report it.');
      fastBookBtn.setAttribute('aria-label', 'Fast Book blocked — cannot identify the open load');
      fastBookBtn.setAttribute('data-testid', 'ext-action-fastbook-blocked-marker');
    }
    return 'abort-no-marker';
  }

  if (!sheetLoadId || !openId || sheetLoadId !== openId) {
    logger.error('inlinePanel', 'executeFastBook: ABORTED — THE BOARD DOES NOT HAVE THIS ' +
      'BUTTON\'S LOAD SELECTED. The load Amazon currently has open is a different one, so ' +
      'booking would have taken the wrong load. NO booking click was sent.', {
        boundLoadId: sheetLoadId || '(missing)',
        openLoadId: openId || '(missing)',
        sheetPresent: !!(sheetOpen && sheetOpen.present),
        intent: ALLOWED_CLICK_INTENTS.FAST_BOOK
      });
    // ⚠ A SILENT ABORT IS UNACCEPTABLE. He pressed Fast Book and expects a booking; if nothing
    // happens and nothing says why, he presses it again. The button is left DISABLED carrying
    // the reason — deliberately NOT reset to 'Fast Book', because a button that looks ready to
    // press is itself a silent failure. Reopening the panel is what clears it.
    if (fastBookBtn) {
      fastBookBtn.disabled = true;
      fastBookBtn.textContent = 'Blocked — wrong load open';
      fastBookBtn.setAttribute('title',
        'Fast Book was blocked. Amazon\'s open load does not match this panel\'s load, so ' +
        'booking would have taken the wrong one. Close the panel, reopen the load you want, ' +
        'and try again.');
      fastBookBtn.setAttribute('aria-label', 'Fast Book blocked — the open load does not match');
      fastBookBtn.setAttribute('data-testid', 'ext-action-fastbook-blocked');
    }
    return 'abort-identity';
  }

  logger.log('inlinePanel', 'executeFastBook: identity check PASSED — the board has the bound ' +
    'load selected', { loadId: sheetLoadId });

  // GATE 2 — THE PAYOUT. The ids agreeing means the DOM says these are the same load; the money
  // agreeing means Amazon's own sheet says so too, through a completely independent field. It
  // catches the case the id check cannot: a stale or mis-keyed record.
  //
  // IT ABSTAINS UNLESS IT HAS A POSITIVE CONTRADICTION — see payoutGateFor(). An absent payout
  // never blocks; only two numbers that disagree do.
  var payGate = payoutGateFor(sheetLoadId, sheet);
  if (payGate.verdict === 'mismatch') {
    logger.error('inlinePanel', 'executeFastBook: ABORTED — THE PAYOUT DISAGREES. The ids ' +
      'matched, but the amount Amazon is showing in the open sheet is not the payout captured ' +
      'for this load. Something is stale or mis-keyed and this booking could be for a different ' +
      'amount than the panel shows. NO booking click was sent.', {
        loadId: sheetLoadId,
        recordPayout: payGate.recordPayout,
        sheetAmounts: payGate.sheetAmounts.slice(0, 8),
        intent: ALLOWED_CLICK_INTENTS.FAST_BOOK
      });
    if (fastBookBtn) {
      fastBookBtn.disabled = true;
      fastBookBtn.textContent = 'Blocked — payout mismatch';
      fastBookBtn.setAttribute('title',
        'Fast Book was blocked. The payout shown in the open load does not match the ' +
        'payout recorded for this load, so booking was refused. Close the panel, reopen the ' +
        'load, and check the amount before booking.');
      fastBookBtn.setAttribute('aria-label', 'Fast Book blocked — the payout does not match');
      fastBookBtn.setAttribute('data-testid', 'ext-action-fastbook-blocked-payout');
    }
    return 'abort-payout';
  }
  if (payGate.verdict === 'abstain') {
    // Recorded, not silent: an abstain means the second gate contributed NOTHING to this booking,
    // and that should be visible rather than looking like a pass.
    logger.warn('inlinePanel', 'executeFastBook: the payout gate ABSTAINED — it could not check ' +
      'this booking, so the identity check is the only thing standing behind it. Booking ' +
      'continues, deliberately.', { loadId: sheetLoadId, why: payGate.why });
  } else {
    logger.log('inlinePanel', 'executeFastBook: payout gate PASSED', {
      loadId: sheetLoadId, recordPayout: payGate.recordPayout
    });
  }
  // 🔑 THE REHEARSAL STOP. HOW "IT CANNOT CLICK" IS GUARANTEED, not hoped:
  // executeFastBook() contains exactly TWO .click() calls — bookBtn.click() on the next line and
  // confirmBtn.click() inside the poll, which is started after it. BOTH are below this return,
  // so a dry run reaches neither. There is no third dispatch site and no path around this line.
  if (dryRun) {
    logger.log('inlinePanel', 'executeFastBook: DRY RUN — every check passed and the Book button ' +
      'was found. Stopping here; nothing was clicked.', { id: bookBtn.id, loadId: sheetLoadId });
    return 'dry-run-would-click';
  }

  logger.log('inlinePanel', 'executeFastBook: clicking Book button', { id: bookBtn.id, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });
  bookBtn.click();

  // Step 2: poll for Amazon's confirm dialog button and click it
  // ⚠ TIMINGS UNCHANGED (2026-08-27) — 100 ms tick, 5 000 ms ceiling, and the
  // `confirmBtn !== bookBtn` exclusion below are all exactly as they were. Only WHERE the
  // fallback looks, and WHO can cancel the poll, changed.
  var MAX_WAIT_MS   = 5000;
  var POLL_MS       = 100;
  var elapsed       = 0;

  // ITEM 3 (BACKLOG 0al): a previous poll must never run alongside a new one. Two live polls
  // would race to click a confirm button, and only one of them belongs to the load on screen.
  if (_fastBookPollInterval !== null) {
    clearInterval(_fastBookPollInterval);
    _fastBookPollInterval = null;
    logger.warn('inlinePanel', 'executeFastBook: cancelled a confirm poll that was still ' +
      'running from an earlier Fast Book');
  }

  _fastBookPollInterval = setInterval(function () {
    elapsed += POLL_MS;
    // ⚠ THE ID LOOKUP STAYS DOCUMENT-WIDE, DELIBERATELY. Amazon's confirm dialog is a modal and
    // may well be portalled to the document root rather than rendered inside the sheet;
    // scoping this one to the sheet could break booking outright. It is an EXACT id, so it
    // cannot match a button belonging to another load.
    var confirmBtn = document.querySelector('#rlb-book-trip-confirm-booking-btn');
    if (!confirmBtn) {
      // ITEM 2 (BACKLOG 0al): the FALLBACK is scoped to the sheet. It used to sweep
      // document.querySelectorAll('button') across the WHOLE page and click the first thing
      // whose text was 'Book' / 'Confirm' / 'Confirm booking' — for five seconds, on a booking
      // path. Any such button anywhere on the page was a candidate. It now looks only inside
      // the sheet element resolved above.
      //
      // ⚠ A CONSEQUENCE, STATED RATHER THAN HIDDEN: if Amazon portals the confirm dialog
      // outside the sheet AND changes that button's id, the fallback will no longer find it and
      // Fast Book will time out at 5 s instead of guessing. That is the correct direction to
      // fail on a booking action — a timeout is recoverable, a wrong click is not.
      var sheetBtnsForConfirm = sheet.querySelectorAll('button');
      for (var j = 0; j < sheetBtnsForConfirm.length; j++) {
        var t = sheetBtnsForConfirm[j].textContent.trim();
        if (t === 'Book' || t === 'Confirm' || t === 'Confirm booking') { confirmBtn = sheetBtnsForConfirm[j]; break; }
      }
    }
    if (confirmBtn && confirmBtn !== bookBtn) {
      clearInterval(_fastBookPollInterval);
      _fastBookPollInterval = null;
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
      clearInterval(_fastBookPollInterval);
      _fastBookPollInterval = null;
      logger.error('inlinePanel', 'executeFastBook: confirm button not found within timeout', { elapsed: elapsed });
      if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    }
  }, POLL_MS);
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
    // Defensive coalesce (2026-08-17): this exact line printed the literal string "undefined" on
    // every stop for as long as the panel existed, because createTextNode(undefined) stringifies.
    // recordToPanelData now always supplies a value; this guarantees that a future caller with a
    // different data shape degrades to an em dash instead of putting "undefined" on screen again.
    td2.appendChild(document.createTextNode(stop.equipmentText || EQUIPMENT_UNKNOWN));

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

  // GATE 1 of 3 (2026-08-27) — WITH FAST_BOOK_ENABLED FALSE THE BUTTON IS NEVER CREATED.
  // Not hidden, not disabled: absent. Nothing to un-hide from the console, and the wiring block
  // in showInlinePanel() finds no node, so no click listener is ever attached either.
  // `typeof` guard so a context that has not loaded constants.js fails CLOSED, not open.
  if (typeof FAST_BOOK_ENABLED === 'undefined' || FAST_BOOK_ENABLED !== true) {
    logger.log('inlinePanel', 'buildActionBar: Fast Book is disabled in this build — no button');
    return bar;
  }

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
  logger.log('inlinePanel', 'findLiveOutermostCard called');
  try {
    var idEl = document.getElementById(loadId);
    if (!idEl) return null;

    // ⚠ THE THIRD INSTANCE OF FAILURE 1, and the one that would have made the other two look
    // like they had not worked. Fixing the click handler let a recently-added card RESOLVE, and
    // fixing the id let it BIND — and then the panel still refused to render, because this
    // function is what visibleAnchorFor() calls and it required the load-card class too. The
    // card exists, is visible, is in the main list, and this returned null.
    //
    // Same rule as everywhere else now: resolveCardForNode(), i.e. cityAssign's.
    // Caught by recentcard-suite, which renders end to end rather than asserting the call.
    var card = resolveCardForNode(idEl);
    if (!card) return null;

    // A card can be nested inside another card match; the outermost is the anchor. Unchanged.
    var outer = card;
    var p = card.parentElement;
    while (p) {
      var candidate = p.closest ? p.closest('div.load-card, div.load-card__selected') : null;
      if (!candidate) break;
      outer = candidate;
      p = candidate.parentElement;
    }
    return outer;
  } catch (e) {
    logger.error('inlinePanel', 'findLiveOutermostCard failed — treating the load as absent, so ' +
      'the panel declines rather than floating over an unknown row', { error: e, loadId: loadId });
    return null;
  }
}

// ── PANEL ANCHORING (2026-08-13) ──────────────────────────────────────────────────────────
//
// THE BUG THIS FIXES: the panel was inserted as a sibling of a REMEMBERED element reference
// (`cardElement.parentNode.insertBefore(...)`) and nothing bound it to the load it described.
// When Amazon swapped the saved-search tab — a client-side re-render, not a page load — React
// reconciled its own children and left our unknown node sitting where it was, while the cards
// around it were replaced. The same MDT4 -> LEWISTOWN -> TREMONT panel then appeared under an
// unrelated load in all five tabs, and with no card above it at all where the list was shorter.
//
// The panel now carries the load id it was opened for, and the rule is absolute: if that id is
// not present AND VISIBLE in the main results list, the panel does not exist.

// The card container for a load id, but ONLY inside the MAIN results list and ONLY if visible.
// Returns null for: no such id, a card in the Similar-matches list, or a card the city filter
// has hidden. A hidden card counts as absent — a panel floating over a hidden row is exactly the
// orphan this prevents.
function visibleAnchorFor(loadId) {
  try {
    if (!loadId) return null;
    var card = findLiveOutermostCard(loadId);
    if (!card) return null;

    // Main list only. Both helpers anchor on the summary panel; either one will do, and if
    // neither has loaded we fall through rather than block the panel.
    var mainList = null;
    if (typeof findMainResultsList === 'function') mainList = findMainResultsList();
    else if (typeof findMainLoadList === 'function') mainList = findMainLoadList();
    if (mainList && !mainList.contains(card)) return null;

    // Hidden by the city filter (or by anything else) -> treat as absent.
    if (card.style && card.style.display === 'none') return null;
    return card;
  } catch (e) {
    logger.error('inlinePanel', 'visibleAnchorFor failed', { error: e, loadId: loadId });
    return null;
  }
}

// Removes the panel unless its load is still on screen; re-seats it if it has drifted.
//
// Called from every place the board can change under it: the render observer (tab switch, a new
// /search render), the city filter, the assignment cycle, and START/STOP. Cheap and idempotent —
// a getElementById plus, at most, one containment check.
//
// RE-SEATS rather than always removing, deliberately: if the load IS still there, destroying the
// panel would reintroduce the "accordion vanishes" bug fixed under PLAN 7b. It is removed only
// when the load it belongs to is genuinely gone or hidden.
function enforcePanelAnchor(reason) {
  try {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return false;

    var loadId = panel.getAttribute('data-load-id');
    if (!loadId) {
      // A panel with no id cannot be verified, so it cannot be trusted to belong here.
      logger.warn('inlinePanel', 'panel has no data-load-id — removing', { reason: reason });
      removeInlinePanel();
      return true;
    }

    var anchor = visibleAnchorFor(loadId);
    if (!anchor) {
      logger.log('inlinePanel', 'panel removed — its load is not visible in the main list', {
        reason: reason, loadId: loadId
      });
      removeInlinePanel();
      return true;
    }

    // Still here, but Amazon may have moved the cards around it. Put it back directly under its
    // own card so it can never read as belonging to a neighbour.
    if (anchor.nextSibling !== panel) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
      currentPanelCard = anchor;
      logger.log('inlinePanel', 're-seated the panel under its own card', {
        reason: reason, loadId: loadId
      });
    }
    return false;
  } catch (e) {
    logger.error('inlinePanel', 'enforcePanelAnchor failed — removing the panel to be safe', {
      error: e, reason: reason
    });
    try { removeInlinePanel(); } catch (e2) {
      logger.error('inlinePanel', 'removal after enforcePanelAnchor failure ALSO failed', { error: e2 });
    }
    return true;
  }
}

// ── STAGE B (2026-08-14): THE RECORD BECOMES THE PANEL ──────────────────────────────────────

// A stop's planned time, rendered in THAT STOP'S OWN local zone.
//
// WHY STOP-LOCAL, and why per stop rather than per load: the payload carries UTC (`2026-08-04T
// 01:30:00Z`) plus a `timeZone` on every stop — 484 of 484 have one. **31% of the captured
// records have stops in more than one zone**, so converting a whole load with a single zone
// would be wrong on nearly a third of them. A dispatcher reads the time at the stop: 01:30 at a
// Chicago dock means 01:30 Chicago, whatever his own clock says. This is the first field he will
// check against Amazon's sheet, so it renders the way Amazon shows it.
//
// The zone abbreviation is appended (CDT/EDT) because on a two-zone load two bare times a few
// hours apart are ambiguous without it.
// FORMAT: "Mon Aug 17 17:30 EDT" — weekday, month, day, time, zone, matching what Amazon's own
// sheet prints (2026-08-17). Time alone was ambiguous the moment a load crossed midnight or ran
// over two days, which the payload routinely does: firstPickupTime and lastDeliveryTime differ by
// a calendar day on most records.
function formatStopTime(iso, timeZone) {
  try {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // No zone on the stop -> show UTC and SAY so, rather than silently using the browser's zone,
    // which would be a different time presented as if it were the stop's. Same date shape.
    if (!timeZone) {
      var u = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(d);
      return assembleStopTime(u, 'UTC');
    }
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZoneName: 'short'
    }).formatToParts(d);
    return assembleStopTime(parts, null);
  } catch (e) {
    logger.error('inlinePanel', 'formatStopTime failed — showing nothing rather than a wrong time', {
      error: e, timeZone: timeZone
    });
    return '';
  }
}

// Assembles the parts in a fixed order rather than trusting the locale's own ordering, so the
// output cannot drift with the browser's locale. `forceZone` supplies the label when the formatter
// was not asked for one (the UTC fallback).
function assembleStopTime(parts, forceZone) {
  var wd = '', mon = '', day = '', hh = '', mm = '', zone = forceZone || '';
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.type === 'weekday')      wd = p.value;
    if (p.type === 'month')        mon = p.value;
    if (p.type === 'day')          day = p.value;
    if (p.type === 'hour')         hh = p.value;
    if (p.type === 'minute')       mm = p.value;
    if (p.type === 'timeZoneName' && !forceZone) zone = p.value;
  }
  if (!hh) return '';
  // 24-hour formatting yields "24" for midnight in some ICU versions; normalise so a stop at
  // midnight does not read "Mon Aug 17 24:00".
  if (hh === '24') hh = '00';
  var date = [wd, mon, day].filter(Boolean).join(' ');
  var time = hh + ':' + mm + (zone ? ' ' + zone : '');
  return date ? (date + ' ' + time) : time;
}

// ── EQUIPMENT (2026-08-17) ───────────────────────────────────────────────────────────────────
//
// THE DEFECT: the renderer reads `stop.equipmentText` and recordToPanelData never set it, so
// every stop printed the literal string "undefined" via createTextNode(undefined).
//
// LABELS ARE BUILT FROM OBSERVED VALUES ONLY. Enumerated across all six captures on disk,
// 159 records / 506 stops — these are the ONLY values that exist:
//
//   loads[i].equipmentType : FIFTY_THREE_FOOT_TRUCK (235), FIFTY_THREE_FOOT_CONTAINER (16)
//   stops[j].loadingType   : null (253), PRELOADED (236), LIVE (17)
//   stops[j].unloadingType : null (253), DROP (226), LIVE (27)
//
// Anything not on these lists renders as an em dash. No label is invented for a value that has
// not been seen — a wrong equipment label on a booking screen is worse than no label.
//
// ⚠ trailerDetails is NOT used, and could not be: .assetId, .assetType, .assetSource and
// .trailerLoadingStatus are null in ALL 253 entries, and .assetOwner (AZNG/NCSL/HUBG/AZNU) is not
// in the record projection — which this task must not change.
var EQUIPMENT_LABELS = {
  FIFTY_THREE_FOOT_TRUCK:    "53' Trailer",
  FIFTY_THREE_FOOT_CONTAINER: "53' Container"
};

// PRELOADED/LIVE/DROP rendered as words, not initials. Amazon's own card shows a single letter
// ("P"), and pairing samples/paired-card.html against paired-search.json PROVES that letter comes
// from loadingType PRELOADED — but that pairing exists for ONE card and one value. Inventing "L"
// and "D" for LIVE and DROP would be exactly the guess this task forbids, so the full word is
// used for all three and the report offers the switch to initials if Ihor wants the tighter match.
var HANDLING_LABELS = {
  PRELOADED: 'Preloaded',
  LIVE:      'Live',
  DROP:      'Drop'
};

var EQUIPMENT_UNKNOWN = '—';   // em dash

// "53' Trailer · Preloaded", or the parts that are known, or an em dash when nothing is.
function formatEquipment(equipmentType, loadingType, unloadingType) {
  try {
    var bits = [];
    if (equipmentType && Object.prototype.hasOwnProperty.call(EQUIPMENT_LABELS, equipmentType)) {
      bits.push(EQUIPMENT_LABELS[equipmentType]);
    }
    // A stop is either loaded or unloaded, never both in the captures; take whichever applies.
    var handling = loadingType || unloadingType || null;
    if (handling && Object.prototype.hasOwnProperty.call(HANDLING_LABELS, handling)) {
      bits.push(HANDLING_LABELS[handling]);
    }
    return bits.length ? bits.join(' · ') : EQUIPMENT_UNKNOWN;
  } catch (e) {
    logger.error('inlinePanel', 'formatEquipment failed', {
      error: e, equipmentType: equipmentType, loadingType: loadingType, unloadingType: unloadingType
    });
    return EQUIPMENT_UNKNOWN;
  }
}

// "2201 W 159TH ST, HARVEY, IL 60428-4804" — the parts that exist, in order, nothing invented.
function formatStopAddress(stop) {
  try {
    var line = [];
    if (stop.line1) line.push(stop.line1);
    var tail = [];
    if (stop.city) tail.push(stop.city);
    if (stop.state) tail.push(stop.state);
    var cs = tail.join(', ');
    if (stop.zip) cs = cs ? cs + ' ' + stop.zip : stop.zip;
    if (cs) line.push(cs);
    return line.join(', ');
  } catch (e) {
    logger.error('inlinePanel', 'formatStopAddress failed', { error: e });
    return '';
  }
}

// Segment duration, DERIVED — the one field the payload has no path for (Stage E of the plan).
// Last CHECKOUT minus first CHECKIN. Returns '' rather than a guess when either is missing.
function segmentDuration(stops) {
  try {
    if (!stops || stops.length === 0) return '';
    var first = stops[0].checkIn;
    var last  = stops[stops.length - 1].checkOut;
    if (!first || !last) return '';
    var ms = new Date(last).getTime() - new Date(first).getTime();
    if (!isFinite(ms) || ms <= 0) return '';
    var mins = Math.round(ms / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');
  } catch (e) {
    logger.error('inlinePanel', 'segmentDuration failed', { error: e });
    return '';
  }
}

// Maps a captured record onto the shape buildPanelElement already renders.
//
// Deliberately a MAPPING, not a new renderer: the existing markup is textContent-only, carries
// its data-testids and its --ext-* tokens, and has been through several rounds of review. Feeding
// it a different source is a far smaller change than rewriting it, and keeps Stage B to what it
// claims to be.
//
// SEGMENTS ARE loads[], iterated — never a fixed two-stop shape. Up to 3 loads and 4 stops each
// were measured, and loads[] order is segment order (verified four ways; see the Stage B report).
function recordToPanelData(record) {
  logger.log('inlinePanel', 'recordToPanelData called');
  try {
    if (!record || !record.loads || record.loads.length === 0) return null;

    var segments = [];
    for (var li = 0; li < record.loads.length; li++) {
      var l = record.loads[li];
      var srcStops = l.stops || [];
      var stops = [];
      for (var si = 0; si < srcStops.length; si++) {
        var st = srcStops[si];
        stops.push({
          num:       (typeof st.seq === 'number') ? st.seq : (si + 1),
          name:      st.label || (st.city || 'Stop'),
          address:   formatStopAddress(st),
          arrival:   formatStopTime(st.checkIn, st.tz),
          departure: formatStopTime(st.checkOut, st.tz),
          // The stop's own handling, whichever applies at this end of the leg.
          loadType:  st.loadingType || st.unloadingType || '',
          loaded:    l.loadType === 'LOADED',
          // THE FIELD THAT WAS MISSING (2026-08-17). The renderer has always read this; nothing
          // ever set it, so every stop printed "undefined". Equipment is a property of the LOAD,
          // handling a property of the STOP, so the cell needs both.
          equipmentText: formatEquipment(l.equipmentType, st.loadingType, st.unloadingType)
        });
      }
      var from = stops.length ? stops[0].name : '';
      var to   = stops.length ? stops[stops.length - 1].name : '';
      segments.push({
        fromTo:   from + ' → ' + to,
        miles:    (typeof l.distance === 'number')
          ? (Math.round(l.distance * 10) / 10) + ' ' + (l.distanceUnit || 'mi') : '',
        duration: segmentDuration(srcStops),
        loadType: l.loadType || '',
        loaded:   l.loadType === 'LOADED',
        stops:    stops
      });
    }

    return {
      stopsCount: (typeof record.stopCount === 'number') ? (record.stopCount + ' stops') : '',
      totalMiles: (typeof record.totalDistance === 'number')
        ? (Math.round(record.totalDistance * 10) / 10) + ' ' + (record.distanceUnit || 'mi') : '',
      payout: (typeof record.payout === 'number')
        ? ((record.payoutUnit === 'USD' ? '$' : '') + record.payout.toFixed(2)) : null,
      segments: segments
    };
  } catch (e) {
    logger.error('inlinePanel', 'recordToPanelData failed — no panel rather than a wrong one', {
      error: e, loadId: record && record.id
    });
    return null;
  }
}

// ── STAGE B: THE PANEL BELONGS TO A LOAD ID ─────────────────────────────────────────────────
//
// The four rules this stage exists to enforce, in the order they are checked:
//   1. No id on the card              -> no panel.
//   2. No record for that id          -> NO PANEL AND NO INTERCEPTION. Amazon's own sheet opens
//                                        exactly as Stage A guarantees; we simply add nothing.
//   3. The id is not in the rendered main list, or its card is hidden by the city filter
//                                     -> no panel. visibleAnchorFor() decides both.
//   4. Otherwise                      -> render from the record, bound to that id.
//
// Every one of those returns false, and false has always meant "no panel" to every caller. There
// is no branch that can leave a panel attached to the wrong load, because the panel is never
// built from anything but the record belonging to the id under it.
// ── PANEL GATE TRACE (2026-08-14) ───────────────────────────────────────────────────────────
//
// WHY THIS EXISTS. The panel silently never appeared, and finding out why meant reading five
// files. Every decision point below now prints ONE line at DEBUG_LEVEL 3 naming which gate
// stopped it and the id involved, so the question is answered by a console filter instead of an
// investigation.
//
// The most important line is the FIRST one: `GATE 0 — reached`. Its absence is the whole answer
// when nothing renders, because it means nothing ever called this function — which is exactly
// what was wrong. A gate trace that only covers the gates cannot report "never asked".
function panelGate(step, loadId, detail) {
  logger.log('inlinePanel', 'PANEL GATE ' + step + (loadId ? '  id=' + loadId : '') +
    (detail ? '  ' + detail : ''));
}

function showInlinePanel(cardElement) {
  logger.log('inlinePanel', 'showInlinePanel called');
  panelGate('0 — reached', null, 'showInlinePanel was CALLED (absence of this line means no ' +
    'caller ran: check initManualToggle and the auto-open path)');

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  // Reads the CARD, never a sheet. By UUID SHAPE as of 2026-08-20 — see cardLoadIdFor().
  var sheetLoadId = cardLoadIdFor(cardElement);
  if (!sheetLoadId) {
    panelGate('1 STOPPED — no load id on the card', null,
      'cardElement ' + (cardElement ? 'present' : 'NULL'));
    logger.warn('inlinePanel', 'no load id on the card — refusing to render an unbindable panel');
    return false;
  }
  panelGate('1 ok — card carries an id', sheetLoadId);

  // RULE 2. No record, no panel — and nothing intercepted. This is the case Ihor refused to
  // accept as a regression, and the answer is that we do nothing at all: his click already
  // reached Amazon before we were asked.
  var haveGetter = (typeof getLoadRecord === 'function');
  var record = haveGetter ? getLoadRecord(sheetLoadId) : null;
  if (!record) {
    // The two causes are very different and must not read the same: a missing GETTER means
    // cityAssign never loaded, a missing RECORD means the capture never covered this load.
    panelGate('2 STOPPED — no captured record', sheetLoadId,
      haveGetter ? 'getLoadRecord() returned null — this id is in no captured response'
                 : 'getLoadRecord is NOT DEFINED — cityAssign.js did not load');
    logger.log('inlinePanel', 'no captured record for this load — leaving Amazon\'s own sheet to it',
      { loadId: sheetLoadId });
    return false;
  }
  panelGate('2 ok — record found', sheetLoadId,
    'loads=' + (record.loads ? record.loads.length : 0));

  var data = recordToPanelData(record);
  if (!data || !data.segments || data.segments.length === 0) {
    panelGate('3 STOPPED — record carries no usable segments', sheetLoadId,
      'recordToPanelData returned ' + (data ? 'a shape with 0 segments' : 'null'));
    logger.warn('inlinePanel', 'record carries no usable segments — no panel', { loadId: sheetLoadId });
    return false;
  }
  panelGate('3 ok — mapped to ' + data.segments.length + ' segment(s)', sheetLoadId);

  // Gates 4 (anchor missing / hidden by the filter) and 5 (the build throwing) are inside
  // renderPanelFromData, which reports them itself.
  return renderPanelFromData(cardElement, sheetLoadId, data);
}

// Everything below this point is the Stage B render path, currently unreachable. Left in place
// deliberately: it is the panel's markup, its actions row and its Fast Book wiring, and Stage B
// re-points it at the captured record rather than rewriting it.
// The render half, now reached from showInlinePanel() with a record-derived `data` and an id
// resolved by the caller. Unchanged in what it BUILDS — textContent only, data-testids, --ext-*
// tokens — only in where its data comes from.
function renderPanelFromData(cardElement, sheetLoadId, data) {
  logger.log('inlinePanel', 'renderPanelFromData called', { loadId: sheetLoadId });

  injectPanelStyle();

  // Phase 2 merge, unchanged: the detail struct is stored under this load's id so PAT and the
  // rest of the app can read it without re-deriving anything.
  loadStore.mergeLoadUnit(sheetLoadId, { detail: data });

  // NEVER INSERT WITHOUT A VISIBLE ANCHOR. Covers the detached-node case (the card element was
  // captured before a re-render) and the hidden-card case (the city filter hid it between the
  // click and the render). Re-resolve from the id rather than trusting the reference we were
  // handed — that reference is precisely what went stale.
  var anchor = visibleAnchorFor(sheetLoadId);
  if (!anchor) {
    // The two reasons are indistinguishable to visibleAnchorFor but very different to diagnose,
    // so name both possibilities rather than one guess.
    var stillOnBoard = !!document.getElementById(sheetLoadId);
    panelGate('4 STOPPED — no visible anchor', sheetLoadId,
      stillOnBoard ? 'the card IS in the DOM, so it is hidden by the city filter or outside the ' +
                     'main results list'
                   : 'the id is not in the DOM at all — not in the rendered page');
    logger.log('inlinePanel', 'anchor card is missing or hidden — not rendering a floating panel', {
      loadId: sheetLoadId
    });
    return false;
  }
  panelGate('4 ok — visible anchor resolved', sheetLoadId);

  var panel = buildPanelElement(data);
  panel.id  = PANEL_ID;
  // The binding the whole fix rests on.
  panel.setAttribute('data-load-id', sheetLoadId);

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
      // F2 (2026-08-19): openPostModal is async. Dropping the promise here is what made a throw
      // inside it invisible — no handler, no console error, no modal. openPostModal now catches
      // its own failures and shows the dispatcher a dialog; this catch is the backstop for a
      // rejection that escapes even that.
      Promise.resolve()
        .then(function () { return openPostModal(sheetLoadId); })
        .catch(function (e) {
          logger.error('inlinePanel', 'ext-action-post: openPostModal rejected — the modal did ' +
            'not open', { error: e, message: e && e.message, stack: e && e.stack, loadId: sheetLoadId });
        });
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

  // Insert against the RE-RESOLVED anchor, not the reference we were handed. On the auto-open
  // path there is an 800 ms settle between the click and this call, and Amazon can re-render
  // inside it — `cardElement` may already be detached, which is how a panel ended up with no
  // card above it.
  anchor.parentNode.insertBefore(panel, anchor.nextSibling);

  // Update currentPanelCard here so both auto-open and manual paths stay in sync.
  // Ownership is here (set) and in removeInlinePanel (clear); initManualToggle no longer touches it.
  currentPanelCard = anchor;

  panelGate('5 ok — PANEL RENDERED', sheetLoadId, data.segments.length + ' segment(s)');
  logger.log('inlinePanel', 'panel rendered', { segments: data.segments.length });
  return true;
}

function removeInlinePanel() {
  // Requirement 3 (2026-07-30): a sheet poll must never outlive teardown. This one call site
  // covers every path that matters — content.js's clearPipelineDom() calls removeInlinePanel(),
  // and clearPipelineDom() is itself called by deactivateExtensionUI() (logout / auth-gate
  // close) AND by every shouldContinue()-failing bail-out checkpoint in runDetectionPipeline.
  // Also covers the toggle-off path below.
  //
  // 2026-08-14: the cancelSheetPoll() call that used to open this function is gone with the
  // poller itself. Its whole purpose was to stop a queued sheet-poll tick from re-creating the
  // panel after teardown — there is no poll and no tick any more, so there is nothing to cancel.
  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();
  currentPanelCard = null;

  // ⚠ THE CONFIRM POLL DIES WITH THE PANEL (2026-08-27, BACKLOG 0al item 3). It used to be a
  // local inside executeFastBook() that nothing outside could reach, so a 5-second poll that
  // clicks a confirm button survived teardown.
  //
  // 🔑 THIS ONE SITE COVERS ALL FOUR enforcePanelAnchor() REMOVALS — verified 2026-08-27:
  // enforcePanelAnchor() removes the panel by calling removeInlinePanel(), never by touching
  // the node itself, on both of its removal branches. cityAssign.js:1806 / :3209 / :3311 and
  // content.js:670 therefore all land here.
  //
  // ⚠ WHAT IT DOES NOT COVER, AND THAT IS OUT OF SCOPE BY INSTRUCTION: showInlinePanel()
  // REPLACES a panel with `old.remove()` directly rather than calling this function, so a poll
  // survives a panel being replaced by another load's. executeFastBook() cancels any live poll
  // when it starts, which closes the two-polls-racing case; a poll left running after a plain
  // replacement is still open. See BACKLOG 0al.
  if (_fastBookPollInterval !== null) {
    clearInterval(_fastBookPollInterval);
    _fastBookPollInterval = null;
    logger.log('inlinePanel', 'removeInlinePanel: cancelled an in-flight Fast Book confirm poll');
  }

  if (_fastBookStorageListener) {
    chrome.storage.onChanged.removeListener(_fastBookStorageListener);
    _fastBookStorageListener = null;
  }
}

// ── CLICKDIAG (2026-08-19) — the click-zone mismatch ──────────────────────────────────────
//
// REPORTED LIVE: clicking the CENTRE of a card highlights it, opens Amazon's sheet and expands
// our accordion. Clicking the very EDGE — a few pixels at the top or bottom — expands ONLY our
// accordion. The hazard is that the highlighted load and the load our panel shows can then be
// DIFFERENT loads.
//
// STRICTLY PASSIVE. Registered in the CAPTURE phase so it reads the DOM as it was at the click,
// before our own handler renders anything. It never calls preventDefault or stopPropagation, so
// it cannot swallow or reorder anything: capture-phase listeners that do neither are invisible to
// every other handler. The existing click handler in initManualToggle() is untouched.
//
// ⚠ WHAT CANNOT BE READ, AND IS THEREFORE NOT CLAIMED. Amazon is a React app; its click handlers
// are synthetic and attached at the root, not as DOM attributes. There is NO way for a content
// script to enumerate them — getEventListeners() is a DevTools-only API and is not available
// here. So C3 does NOT report "Amazon's listener". It reports what IS readable on the nodes:
// anchors, buttons, role attributes, tabindex, and the click GEOMETRY relative to each. Anything
// stronger than that would be a guess.
//
// Registered only when the debug flag is on, so a shipped build carries no extra listener at all.

// The bare-UUID shape, as documented in AMAZON_SELECTORS.md ("Count cards by ID SHAPE"). Reuses
// cityAssign's constant when that file is loaded so there is one definition in practice.
function clickDiagUuidRe() {
  if (typeof CARD_UUID_RE !== 'undefined') return CARD_UUID_RE;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
}

function clickDiagEnabled() {
  return (typeof CITY_ASSIGN_DEBUG !== 'undefined') && CITY_ASSIGN_DEBUG;
}

// A node as one readable line. Never a css-<hash> anchor — the classes are PRINTED as evidence,
// never selected on.
function clickDiagDescribe(el) {
  try {
    if (!el || !el.tagName) return '(no element)';
    var cls = String(el.className || '');
    if (cls.length > 90) cls = cls.slice(0, 90) + '…';
    var id = el.id ? ' id=' + el.id : '';
    var role = (el.getAttribute && el.getAttribute('role')) ? ' role=' + el.getAttribute('role') : '';
    var ti = (el.getAttribute && el.getAttribute('tabindex') !== null &&
              el.getAttribute('tabindex') !== undefined)
      ? ' tabindex=' + el.getAttribute('tabindex') : '';
    var testid = (el.getAttribute && el.getAttribute('data-testid'))
      ? ' data-testid=' + el.getAttribute('data-testid') : '';
    return '<' + String(el.tagName).toLowerCase() + '>' + id + role + ti + testid +
           (cls ? '  class="' + cls + '"' : '  (no class)');
  } catch (e) {
    logger.error('inlinePanel', 'clickDiagDescribe failed — diagnostics only', { error: e });
    return '(describe failed)';
  }
}

// Is this node one the DOM itself marks as interactive? Anchors and buttons are unambiguous;
// role and tabindex are the only other readable signals. This is a proxy, and is labelled as one.
function clickDiagInteractive(el) {
  try {
    if (!el || !el.tagName) return null;
    var tag = String(el.tagName).toLowerCase();
    if (tag === 'a') return 'anchor';
    if (tag === 'button') return 'button';
    if (!el.getAttribute) return null;
    var role = el.getAttribute('role');
    // role="img" is NOT interactive — it is on the icon spans and would otherwise dominate this
    // report. Measured in samples/paired-card.html: 5 role="img", 0 anchors, 0 buttons.
    if (role && role !== 'img' && role !== 'presentation' && role !== 'none') return 'role=' + role;
    var ti = el.getAttribute('tabindex');
    if (ti !== null && ti !== undefined && String(ti) !== '-1') return 'tabindex=' + ti;
    return null;
  } catch (e) {
    logger.error('inlinePanel', 'clickDiagInteractive failed — diagnostics only', { error: e });
    return null;
  }
}

// Distance from a point to each edge of a rect, so "a few pixels at the top" becomes a number.
function clickDiagEdges(rect, x, y) {
  return 'top+' + Math.round(y - rect.top) + ' bottom+' + Math.round(rect.bottom - y) +
         ' left+' + Math.round(x - rect.left) + ' right+' + Math.round(rect.right - x) +
         '  (card is ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
}

function clickDiagPointInRect(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// The id our own render path would resolve for this card — deliberately the SAME function
// showInlinePanel() uses, so this reports what the panel will actually bind to, not what it
// ought to. Updated 2026-08-20 with it: the panel now selects by UUID SHAPE, so a diagnostic
// still reading the first div[id] would report a badge id the panel never uses.
function clickDiagOurLoadId(card) {
  try {
    return card ? cardLoadIdFor(card) : null;
  } catch (e) {
    logger.error('inlinePanel', 'clickDiagOurLoadId failed — diagnostics only', { error: e });
    return null;
  }
}

// Every dollar amount in the open sheet, as numbers, de-duplicated.
//
// NO LOCALISED WORD IS USED AS AN ANCHOR. It does not look for "Payout", "Total" or any other
// label — those are translated and re-worded, and anchoring on one would make this break
// silently in another locale. It parses AMOUNTS ONLY.
//
// The sheet prints several amounts (the payout, and rate-per-mile figures), so this returns ALL
// of them and the caller asks whether the record's payout is AMONG them. A per-mile figure is a
// couple of dollars and a payout is hundreds, so the two do not realistically collide.
//
// If the currency symbol is ever localised away, this returns [] and the gate ABSTAINS. That is
// the correct direction to fail for a SECOND line of defence: it must never become a new way to
// block a legitimate booking.
function sheetPayoutAmounts(sheet) {
  logger.log('inlinePanel', 'sheetPayoutAmounts called');
  try {
    if (!sheet) return [];
    var text = sheet.textContent || '';
    var re   = /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
    var out = [], m;
    while ((m = re.exec(text)) !== null) {
      var v = parseFloat(m[1].replace(/,/g, ''));
      if (isFinite(v) && out.indexOf(v) === -1) out.push(v);
    }
    return out;
  } catch (e) {
    logger.error('inlinePanel', 'sheetPayoutAmounts failed — returning none, so the payout gate ' +
      'ABSTAINS rather than blocking a booking it could not read', { error: e });
    return [];
  }
}

// THE SECOND GATE. The identity check answers "is this the right load?" from ids; this asks the
// same question of the MONEY, which is the thing the dispatcher actually cares about being wrong.
//
// IT ABSTAINS RATHER THAN BLOCKS. If the record has no payout, or nothing parses out of the
// sheet, the verdict is 'abstain' and booking proceeds on the identity check alone. A second
// line of defence that can itself break booking is a liability, not a defence. It ABORTS only
// when it has both numbers AND THEY DISAGREE — a positive contradiction, never an absence.
//
// Returns { verdict: 'match' | 'mismatch' | 'abstain', why, recordPayout, sheetAmounts }.
function payoutGateFor(boundId, sheet) {
  logger.log('inlinePanel', 'payoutGateFor called');
  try {
    var rec = (typeof getLoadRecord === 'function') ? getLoadRecord(boundId) : null;
    if (!rec) return { verdict: 'abstain', why: 'no-record', recordPayout: null, sheetAmounts: [] };

    // The curated record flattens payout to a NUMBER (networkObserver.js projectRecord). The raw
    // API shape is { value, unit }, so both are accepted — the brief named the raw one.
    var pay = rec.payout;
    if (pay && typeof pay === 'object' && typeof pay.value === 'number') pay = pay.value;
    if (typeof pay !== 'number' || !isFinite(pay)) {
      return { verdict: 'abstain', why: 'record-has-no-payout', recordPayout: null, sheetAmounts: [] };
    }

    var amounts = sheetPayoutAmounts(sheet);
    if (!amounts.length) {
      return { verdict: 'abstain', why: 'no-amount-in-sheet', recordPayout: pay, sheetAmounts: [] };
    }
    for (var i = 0; i < amounts.length; i++) {
      if (Math.abs(amounts[i] - pay) <= PAYOUT_TOLERANCE) {
        return { verdict: 'match', why: 'matched', recordPayout: pay, sheetAmounts: amounts };
      }
    }
    return { verdict: 'mismatch', why: 'no-amount-matches', recordPayout: pay, sheetAmounts: amounts };
  } catch (e) {
    logger.error('inlinePanel', 'payoutGateFor failed — ABSTAINING, so a broken second gate ' +
      'cannot block a booking the identity check already approved', { error: e });
    return { verdict: 'abstain', why: 'threw', recordPayout: null, sheetAmounts: [] };
  }
}

// The id of the load Amazon currently has OPEN, read from the SELECTED CARD ON THE BOARD.
//
// DEAD HYPOTHESIS — DO NOT RE-DERIVE IT (measured on a real board, 2026-08-27)
// This function used to read the id out of the detail sheet itself. THE SHEET DOES NOT CARRY
// THE LOAD ID. Measured, not guessed: #selected-work-sheet contains exactly eight elements with
// an id — rlb-book-btn, rlb-book-trip-no-btn, rlb-book-trip-confirm-booking-btn, alert-:r7j:,
// alert-:r7j:-children, expanded-header, alert-:r7k:, alert-:r7k:-children — and NONE is a load
// id. A full attribute scan of the sheet found ZERO UUIDs and no work/load/opportunity-named
// attribute. The id is not in the URL either; it stays /loadboard/search.
//
// THAT DEFECT WAS LIVE. Reading the sheet returned null every single time, so the Fast Book
// identity guard — which fails closed by design — aborted EVERY press with sheetLoadId
// '(missing)'. Fast Book was blocked outright. If a future change is tempted back toward the
// sheet for this id, that is the bug being reintroduced.
//
// THE REAL SOURCE, also measured: Amazon marks the open card on the board with the class
// load-card__selected, and that card contains exactly ONE bare UUID. See AMAZON_SELECTORS.md.
//
// ⚠ THIS IS NO LONGER DIAGNOSTICS-ONLY, AND THAT IS WHY IT WAS RENAMED (2026-08-27). The Fast
// Book identity check depends on it, so a future cleanup must not delete it as debug code or
// soften its error path. Its old name and its old "diagnostics only" catch message both said it
// was expendable; neither is true now.
//
// 🔑 ONE DEFINITION OF THE ID-SHAPE RULE. clickDiagSheetLoadId() below delegates here rather
// than keeping its own copy. Three copies of a card lookup have already cost this project once
// (two were fixed, the third kept the bug alive) — that is not repeated for a booking check.
//
// ⚠ EVERY FAILURE RETURNS id: null, DELIBERATELY. Callers must treat "no id" as "do not
// proceed". A board that is absent, unmarked, or unreadable must never look like agreement.
//
// `reason` says WHICH failure it was, because they are not the same problem: 'no-selected-card'
// means AMAZON'S CLASS CHANGED and every press will now block, whereas 'no-uuid' / 'ambiguous'
// mean the markup inside the card moved. The caller turns that into distinct wording.
function sheetOpenLoadId() {
  logger.log('inlinePanel', 'sheetOpenLoadId called');
  try {
    // THE SHEET IS STILL REQUIRED. `present` still means the DETAIL SHEET is open and booking
    // still refuses without it. Only the SOURCE OF THE ID moved to the board — the sheet is what
    // carries the Book button, so its absence still means there is nothing to press.
    var sheet = document.querySelector(SHEET_SELECTOR);
    if (!sheet) return { present: false, id: null, reason: 'no-sheet' };

    var cards = document.querySelectorAll(SELECTED_CARD_SELECTOR);
    if (!cards || !cards.length) {
      // LOUD ON PURPOSE. This is the shape a changed Amazon class takes, and it would block every
      // booking until someone noticed. It must never be a quiet null — that was the 2026-08-27
      // defect exactly.
      logger.error('inlinePanel', 'sheetOpenLoadId: THE SELECTED-CARD MARKER WAS NOT FOUND. ' +
        'Nothing on the page matches the marker, so the open load cannot be identified and Fast ' +
        'Book will refuse to book. This is what a changed Amazon class looks like — re-measure ' +
        'the board and update AMAZON_SELECTORS.md.', { selector: SELECTED_CARD_SELECTOR });
      return { present: true, id: null, reason: 'no-selected-card' };
    }

    // THE ID-SHAPE RULE IS REUSED, NOT RECOPIED. clickDiagUuidRe() resolves to cityAssign's
    // CARD_UUID_RE when that file is loaded, so there is one definition of what a load id looks
    // like. cardLoadIdFor() is deliberately NOT called here: it falls back to the first div[id]
    // when no UUID is present, which is right for RENDERING a panel and wrong for a BOOKING gate
    // — that fallback would hand back a badge id and let a press through on an unidentified load.
    var re = clickDiagUuidRe();
    var distinct = [];
    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      if (card.id && re.test(card.id) && distinct.indexOf(card.id) === -1) distinct.push(card.id);
      var els = card.querySelectorAll ? card.querySelectorAll('[id]') : [];
      for (var i = 0; i < els.length; i++) {
        var eid = els[i].id;
        if (eid && re.test(eid) && distinct.indexOf(eid) === -1) distinct.push(eid);
      }
    }

    if (!distinct.length) {
      logger.error('inlinePanel', 'sheetOpenLoadId: the selected card carries NO UUID-shaped id, ' +
        'so the open load cannot be identified', {
          selector: SELECTED_CARD_SELECTOR, selectedCards: cards.length
        });
      return { present: true, id: null, reason: 'no-uuid' };
    }
    if (distinct.length > 1) {
      // AMBIGUITY IS REFUSED, NEVER GUESSED. Two distinct ids under the selected marker means we
      // do not know which load is open, and picking one would be inventing the answer.
      logger.error('inlinePanel', 'sheetOpenLoadId: MORE THAN ONE distinct load id under the ' +
        'selected-card marker — refusing to guess which load is open', {
          selector: SELECTED_CARD_SELECTOR, count: distinct.length, ids: distinct.slice(0, 4)
        });
      return { present: true, id: null, reason: 'ambiguous' };
    }
    return { present: true, id: distinct[0], reason: 'ok' };
  } catch (e) {
    logger.error('inlinePanel', 'sheetOpenLoadId failed — reporting NO id, so every caller ' +
      'fails closed rather than proceeding on an unread board', { error: e });
    return { present: false, id: null, reason: 'error' };
  }
}

// Kept as the CLICKDIAG-facing name so its existing callers do not change. One implementation.
function clickDiagSheetLoadId() {
  return sheetOpenLoadId();
}

function initClickZoneDiagnostic() {
  logger.log('inlinePanel', 'initClickZoneDiagnostic called');
  try {
    if (window.__extClickDiagInit) return;
    if (!clickDiagEnabled()) return;          // shipped build: no listener is registered at all
    window.__extClickDiagInit = true;

    document.addEventListener('click', function (ev) {
      try {
        var target = ev.target;
        if (!target || !target.closest) return;

        // Scope: only clicks inside the MAIN results list. findMainResultsList() is cityAssign's
        // and already excludes the Similar-matches list.
        var mainList = (typeof findMainResultsList === 'function') ? findMainResultsList() : null;
        if (!mainList || !mainList.contains || !mainList.contains(target)) return;

        // ── C2 (computed first, because C1's path terminates at this element) ──
        // EXACTLY what initManualToggle() uses — the same function call, not a copy of it.
        // Before 2026-08-20 this was closest('div.load-card, div.load-card__selected'), which is
        // what reported "no match" on the recently-added card that Amazon itself opened fine.
        var card = resolveCardForNode(target);
        var ourId = clickDiagOurLoadId(card);
        var re = clickDiagUuidRe();

        logger.log('inlinePanel', 'CLICKDIAG ─────────── click in the main results list ───────────');

        // ── C1 TARGET ──
        logger.log('inlinePanel', 'CLICKDIAG C1 TARGET   ' + clickDiagDescribe(target));
        var hops = 0, node = target;
        while (node && node !== mainList && hops < 12) {
          logger.log('inlinePanel', 'CLICKDIAG C1 PATH     ' + (node === target ? '  target  ' : '  ^' + hops + '      ') +
            clickDiagDescribe(node) + (node === card ? '   <<< THE CARD our handler matched' : ''));
          if (node === card) break;
          node = node.parentElement; hops++;
        }
        if (!card) {
          logger.log('inlinePanel', 'CLICKDIAG C1 PATH     (no div.load-card ancestor — our handler ' +
            'would NOT treat this as a card click)');
        }

        // ── C2 OUR MATCH ──
        if (!card) {
          logger.log('inlinePanel', 'CLICKDIAG C2 OURS     no match — initManualToggle() returns early ' +
            'on this click, so nothing of ours runs');
        } else {
          logger.log('inlinePanel', 'CLICKDIAG C2 OURS     matched ' +
            (target === card
              ? '** THE CARD CONTAINER ITSELF ** — the click landed on the container, not on any ' +
                'inner element. closest() matches the container, so OUR handler fires for clicks ' +
                'anywhere in its box, including its own padding and border.'
              : 'an ancestor ' + hops + ' hop(s) above the target: ' + clickDiagDescribe(card)) +
            '  ||  resolved load id: ' + (ourId === null ? 'NONE' : ourId) +
            (ourId === null ? '' : (re.test(ourId)
              ? '  (bare UUID, as expected)'
              : '  ** NOT A BARE UUID — showInlinePanel takes the FIRST div[id] and does not ' +
                'filter by shape, so this is what the panel would bind to **')));
        }

        // ── C3 AMAZON'S ZONE ──
        logger.log('inlinePanel', 'CLICKDIAG C3 ZONE     ⚠ Amazon is React: its click handlers are ' +
          'synthetic and cannot be enumerated from a content script (getEventListeners is ' +
          'DevTools-only). What follows is what the DOM itself marks, plus geometry — not a ' +
          'listener list.');
        var innermost = null, walker = target, guard = 0;
        while (walker && walker !== mainList && guard < 12) {
          var kind = clickDiagInteractive(walker);
          if (kind) {
            logger.log('inlinePanel', 'CLICKDIAG C3 ZONE     interactive ancestor [' + kind + ']  ' +
              clickDiagDescribe(walker));
            if (!innermost) innermost = walker;
          }
          if (walker === card) break;
          walker = walker.parentElement; guard++;
        }
        var x = ev.clientX, y = ev.clientY;
        if (!innermost) {
          logger.log('inlinePanel', 'CLICKDIAG C3 ZONE     ** NO anchor, button, role or tabindex ' +
            'anywhere between the target and the card ** — nothing the DOM marks as clickable ' +
            'was hit. Amazon may still handle it, but nothing readable says so.');
        } else {
          var ir = innermost.getBoundingClientRect();
          var inside = clickDiagPointInRect(ir, x, y);
          logger.log('inlinePanel', 'CLICKDIAG C3 ZONE     click (' + Math.round(x) + ',' + Math.round(y) +
            ') is ' + (inside ? 'INSIDE' : '** OUTSIDE **') + ' the innermost interactive element\'s box ' +
            '[' + Math.round(ir.left) + ',' + Math.round(ir.top) + ' ' + Math.round(ir.width) + 'x' +
            Math.round(ir.height) + ']');
        }
        if (card) {
          var cr = card.getBoundingClientRect();
          logger.log('inlinePanel', 'CLICKDIAG C3 ZONE     distance from the CARD edges: ' +
            clickDiagEdges(cr, x, y));
        }

        // ── C4 OUTCOME, 300 ms later ──
        var classesBefore = card ? String(card.className || '') : '';
        var sheetBefore = clickDiagSheetLoadId();
        var cardRef = card;
        setTimeout(function () {
          try {
            var addedList = [];
            if (cardRef) {
              var before = classesBefore.split(/\s+/);
              var after = String(cardRef.className || '').split(/\s+/);
              for (var a = 0; a < after.length; a++) {
                if (after[a] && before.indexOf(after[a]) === -1) addedList.push(after[a]);
              }
            }
            // Which card the board currently shows as selected. 'load-card__selected' is already
            // part of this codebase's own documented selector list — not a guess.
            var selEl = document.querySelector('div.load-card__selected');
            var selIdEl = selEl ? selEl.querySelector('div[id]') : null;
            var selId = selIdEl ? selIdEl.id : null;

            var panel = document.getElementById(PANEL_ID);
            var panelId = panel ? panel.getAttribute('data-load-id') : null;
            var sheetAfter = clickDiagSheetLoadId();

            var gotHighlight = addedList.length > 0 || !!selEl;
            var sheetChanged = (sheetBefore.id !== sheetAfter.id);
            var panelRendered = !!panel;

            logger.log('inlinePanel', 'CLICKDIAG C4 OUTCOME  +300ms  |  card gained a class: ' +
              (addedList.length ? 'YES [' + addedList.join(' ') + ']' : 'no') +
              '  |  Amazon sheet id changed: ' + (sheetChanged ? 'YES' : 'no') +
              ' (' + (sheetBefore.id || (sheetBefore.present ? 'no UUID readable in the sheet' : 'no sheet')) +
              ' -> ' + (sheetAfter.id || (sheetAfter.present ? 'no UUID readable in the sheet' : 'no sheet')) + ')' +
              '  |  our panel rendered: ' + (panelRendered ? 'YES' : 'no'));
            logger.log('inlinePanel', 'CLICKDIAG C4 IDS      highlighted card: ' + (selId || 'NONE') +
              '   |   our panel: ' + (panelId || 'NONE') +
              '   |   ' + ((selId && panelId && selId !== panelId)
                ? '*** MISMATCH — the highlighted load and the panel\'s load are DIFFERENT ***'
                : (panelRendered && !selId
                    ? '*** PANEL WITHOUT A HIGHLIGHT — ours expanded, Amazon did not select ***'
                    : (selId && panelId ? 'match' : 'nothing to compare'))));
            logger.log('inlinePanel', 'CLICKDIAG C4 SUMMARY  highlight=' + gotHighlight +
              '  sheetChanged=' + sheetChanged + '  panel=' + panelRendered);
          } catch (e2) {
            logger.error('inlinePanel', 'CLICKDIAG outcome pass failed — diagnostics only', { error: e2 });
          }
        }, 300);
      } catch (e) {
        // Must never affect the click. Swallowed after logging, and nothing here can propagate:
        // preventDefault and stopPropagation are never called anywhere in this listener.
        logger.error('inlinePanel', 'CLICKDIAG failed — diagnostics only, the click is unaffected',
          { error: e });
      }
    }, true);   // CAPTURE phase, passive

    logger.log('inlinePanel', 'CLICKDIAG active — passive capture-phase observer registered');
  } catch (e) {
    logger.error('inlinePanel', 'initClickZoneDiagnostic failed', { error: e });
  }
}

// ── FAILURE 1 (measured 2026-08-20): the recently-added card has NO div.load-card ancestor ──
//
// CLICKDIAG on a failed auto-open:
//     C1 PATH ^6  <div> class="wo-card-header--highlighted ext-new-load"
//     C1 PATH     (no div.load-card ancestor — our handler would NOT treat this as a card click)
//     C2 OURS     no match — initManualToggle() returns early
//     outcome: highlight=true, panel=FALSE
//
// Amazon opened its own sheet; we rendered nothing. The card is the known recently-added one,
// established live on 2026-08-13: it carries a DIFFERENT class from ordinary cards.
//
// 🔑 THIS EXACT FACT ALREADY DRIVES cityAssign. A measured 9-result board found 8 cards by class
// and 9 by UUID-shaped id, which is why readRenderedCardIds() counts BY ID SHAPE, NOT BY CARD
// CLASS. The panel's own lookup never got the same treatment — it required the load-card class —
// so a recently-added load opened Amazon's card and none of ours.
//
// ⚠ THE RULE IS REUSED, NOT REIMPLEMENTED. This calls cityAssign's readMainCardElements(), which
// is already "every bare-UUID div[id] in the main list -> cardContainerFor()". A second copy of
// the rule here would be a second thing to keep in step, and the 2026-08-13 measurement says the
// class list is the part that goes stale.
//
// ⚠ AND IT DOES NOT ANCHOR ON wo-card-header--highlighted. That is a STATE class — it marks a
// card as recently added, not as a card — and a rule built on it would break the moment Amazon
// stops highlighting. The anchor is the id SHAPE, which every card carries.
//
// Returns null when the node is not in a main-list card, which every caller treats exactly as
// the old closest() returning null did.
function resolveCardForNode(node) {
  logger.log('inlinePanel', 'resolveCardForNode called');
  try {
    if (!node) return null;

    // cityAssign.js is listed AFTER this file in the manifest, so guard on the function rather
    // than the load order. The fallback is the OLD selector — the previous behaviour exactly,
    // not a second divergent rule — because a panel that mostly works beats no panel at all if
    // cityAssign ever fails to load.
    if (typeof readMainCardElements !== 'function') {
      logger.warn('inlinePanel', 'readMainCardElements is not defined — cityAssign.js did not ' +
        'load; falling back to the pre-2026-08-20 class selector, which misses recently-added cards');
      return node.closest ? node.closest('div.load-card, div.load-card__selected') : null;
    }

    var cards = readMainCardElements();
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i].el;
      if (el === node) return el;
      if (el.contains && el.contains(node)) return el;
    }
    return null;
  } catch (e) {
    logger.error('inlinePanel', 'resolveCardForNode failed — treating the click as not-a-card, ' +
      'which renders nothing and leaves Amazon untouched', { error: e });
    return null;
  }
}

// The load id ON a card, by the SAME shape rule.
//
// ⚠ WHY THE FIRST div[id] IS NOT ENOUGH. Cards also contain div[id="STARTING_SOON"] and other
// badge ids — cityAssign's readRenderedCardIds() filters them out for exactly this reason, and
// its comment calls the filter load-bearing. showInlinePanel() took the FIRST div[id] with no
// shape filter, so on a card whose badge markup comes first it would bind the panel to a badge
// id, find no record for it, and decline. Same defect family as failure 1, same fix.
//
// The regex is CARD_UUID_RE via clickDiagUuidRe(), which already resolves to cityAssign's
// constant when that file is loaded — one definition in practice.
function cardLoadIdFor(cardElement) {
  logger.log('inlinePanel', 'cardLoadIdFor called');
  try {
    if (!cardElement || typeof cardElement.querySelectorAll !== 'function') return null;
    var re  = clickDiagUuidRe();
    var els = cardElement.querySelectorAll('div[id]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].id && re.test(els[i].id)) return els[i].id;
    }
    // No UUID-shaped id anywhere on this card. Fall back to the first div[id] — the exact
    // pre-2026-08-20 behaviour — so nothing that used to render stops rendering.
    var first = cardElement.querySelector('div[id]');
    return first ? first.id : null;
  } catch (e) {
    logger.error('inlinePanel', 'cardLoadIdFor failed — no id, so the panel declines rather than ' +
      'binding to the wrong load', { error: e });
    return null;
  }
}

function initManualToggle() {
  if (window.__extManualToggleInit) return;
  window.__extManualToggleInit = true;

  document.addEventListener('click', function (ev) {
    // FAILURE 1 FIX (2026-08-20): resolved by cityAssign's id-shape rule, not by requiring the
    // load-card class — see resolveCardForNode() above. The container-target guard immediately
    // below is UNCHANGED and still compares ev.target against whatever this returns.
    var card = resolveCardForNode(ev.target);
    if (!card) return;

    // CONTAINER-PADDING CLICK — IGNORE IT ENTIRELY (2026-08-19).
    //
    // MEASURED, six clicks with CLICKDIAG on 2026-08-19. When the click target is a DESCENDANT of
    // the card, Amazon highlights the card (load-card__selected) and our panel renders, and the
    // two ids MATCH. When the target IS div.load-card itself — the container's own padding, a few
    // pixels along the top and bottom of a 72 px card — Amazon does NOT highlight, but our panel
    // rendered anyway. All three such clicks logged
    //     *** MISMATCH — the highlighted load and the panel's load are DIFFERENT ***
    // which is the real hazard: the dispatcher reads one load's data believing it belongs to the
    // load Amazon still has selected.
    //
    // THE RULE IS TARGET IDENTITY, NOT GEOMETRY. The offsets above (top+4, bottom+6, bottom+7 for
    // the ignored clicks; top+14, top+19, top+31, bottom+42 for the working ones) were how the
    // problem was MEASURED — they are deliberately not how it is decided. No pixel threshold, no
    // bounding box, no offset: if the click hit no child of the card, it is not a card click.
    //
    // ⚠ WE DO NOT TRY TO DETECT AMAZON'S LISTENER. Amazon is React, its handlers are synthetic and
    // cannot be enumerated from a content script. This rule never asks what Amazon bound to; it
    // only asks whether the dispatcher's click landed on anything at all inside the card.
    //
    // NOTHING IS INTERCEPTED, here or anywhere in this handler: no preventDefault, no
    // stopPropagation. The click still reaches Amazon exactly as it would with the extension
    // uninstalled — including this ignored case, where Amazon's own answer is also to do nothing.
    //
    // Placed immediately after the "not a card at all" return and BEFORE everything else, so an
    // ignored click resolves no load id, renders no panel, touches no state and — importantly —
    // does not stop the refresh loop.
    if (ev.target === card) {
      logger.log('inlinePanel', 'click ignored — landed on the card container itself, not on any ' +
        'descendant (container padding). Amazon does not select the card for this click either, ' +
        'so opening our panel would show a load the board has not highlighted.');
      return;
    }

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

    // RENDER (STAGE B, wired 2026-08-14).
    //
    // ⚠ THIS CALL IS THE WHOLE FEATURE, AND IT WAS MISSING. Stage A removed the sheet poll that
    // used to end this handler and left a note saying Stage B would replace it; Stage B rebuilt
    // showInlinePanel() from the captured record and never re-added the call. The function was
    // correct and unreachable, so clicking a card opened Amazon's sheet and nothing of ours —
    // with no error anywhere, because nothing ran. 1220 tests passed throughout, one of which
    // asserted the absence of this very call.
    //
    // NO POLL, NO SLEEP: the record is already in memory before the card renders, which is the
    // entire point of rendering from the capture rather than from the DOM.
    //
    // The try/catch is not decoration. This handler is registered on `document` and is not the
    // only listener on a card click — an uncaught throw here would break the click for whatever
    // else is bound, and would do it silently from the dispatcher's side. showInlinePanel() only
    // ever returns false when it declines; a throw means a real defect, so it is logged at error
    // level and visible at the shipped DEBUG_LEVEL.
    try {
      showInlinePanel(card);
    } catch (e) {
      logger.error('inlinePanel', 'manual card open — panel render threw', { error: e });
    }

    // ⚠ THE CLICK IS STILL NOT INTERCEPTED. There is no preventDefault and no stopPropagation
    // anywhere in this handler, so the click reaches Amazon and its own detail sheet opens
    // exactly as it would with the extension uninstalled — including for a load whose record we
    // never captured, where showInlinePanel() declines and we add nothing. That is Ihor's "no
    // regression is accepted" requirement, and it still holds by construction.
  });

  // CLICKDIAG (2026-08-19). Registered alongside, never inside, the handler above — that
  // handler is not modified in any way by this diagnostic.
  initClickZoneDiagnostic();

  logger.log('inlinePanel', 'manual toggle initialized');
}

// Expose for manual console testing only — NOT called automatically.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.showPanel        = function () {
  // 2026-08-20: resolved the same way the handler does, so testing from the console exercises
  // the real path — including on a recently-added card, which the old class selector missed.
  var cards = (typeof readMainCardElements === 'function') ? readMainCardElements() : [];
  var c = cards.length ? cards[0].el
                       : document.querySelector('div.load-card__selected, div.load-card');
  return showInlinePanel(c);
};
window.__EXT_DEBUG.removePanel      = removeInlinePanel;
window.__EXT_DEBUG.initManualToggle = initManualToggle;

// ── FAST BOOK REHEARSAL (2026-08-27) ──────────────────────────────────────────────────────
//
// WHY: Ihor will not press Fast Book on a live board — a wrong click costs a real load and a
// cancellation ding. These let him watch the identity guard work with no booking possible.
//
// 🔑 THE PROPERTY THAT MAKES THIS SAFE, and it is structural rather than lucky: on a mismatch
// executeFastBook() aborts BEFORE bookBtn.click(). So a forced mismatch exercises the whole
// pre-click path and cannot reach a click by construction.
//
// console.* on purpose, like the simulate* helpers, so they work at the shipped DEBUG_LEVEL.
//   __EXT_DEBUG.fastBookDryRun()          rehearse against the sheet that is open NOW
//   __EXT_DEBUG.fastBookForceMismatch()   make the NEXT real press abort, once

// Runs the REAL pre-click sequence and stops immediately before the Book click.
//
// ⚠ IT CANNOT CLICK, AND HERE IS WHY. It passes dryRun = true, and executeFastBook() returns on
// that flag on the line before bookBtn.click(); the confirm poll is started later still. Those
// are the only two .click() calls in the function. It also passes fastBookBtn = null, so it
// cannot even change the button's appearance.
window.__EXT_DEBUG.fastBookDryRun = function () {
  logger.log('inlinePanel', 'fastBookDryRun called');
  try {
    // Say it plainly rather than running a rehearsal whose every line would read "would abort"
    // for a reason that has nothing to do with the guards it exists to demonstrate.
    if (typeof FAST_BOOK_ENABLED === 'undefined' || FAST_BOOK_ENABLED !== true) {
      console.log('[EXT] Fast Book is DISABLED IN THIS BUILD (FAST_BOOK_ENABLED is false), so ' +
        'there is nothing to rehearse.' +
        '\n      No button is created, the popup toggle is not rendered, and executeFastBook()' +
        '\n      refuses at entry. Set FAST_BOOK_ENABLED = true in utils/constants.js to restore it.');
      return { disabled: true };
    }
    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      console.log('[EXT] fastBookDryRun: no inline panel is open. Click a load card first.');
      return null;
    }
    // The id the panel is BOUND to — the same value the button's closure holds, written to the
    // panel at render time. Read from the DOM rather than re-derived.
    var boundId = panel.getAttribute('data-load-id');
    var open    = sheetOpenLoadId();
    var openId  = open ? open.id : null;
    var openWhy = open ? open.reason : 'error';
    var match   = !!(boundId && openId && boundId === openId);

    // THE REAL FUNCTION, REAL CHECKS. Not a copy of them.
    var outcome = executeFastBook(boundId, null, true);

    // THE TWO GATES ARE PRINTED SEPARATELY, on purpose. They fail for different reasons and one
    // can abstain while the other passes; collapsing them into a single verdict would hide which
    // one actually stood behind the booking.
    var sheetEl = document.querySelector(SHEET_SELECTOR);
    var pay     = payoutGateFor(boundId, sheetEl);
    // Parsed here for DISPLAY. The gate short-circuits before parsing when it has no record to
    // compare against, so pay.sheetAmounts would read '(none parsed)' on a sheet that plainly
    // shows a payout — a diagnostic that misreports the page is worse than no diagnostic.
    var shown   = sheetPayoutAmounts(sheetEl);
    var money   = function (a) { return '$' + a.toFixed(2); };
    var payLine;
    if (pay.verdict === 'match') {
      payLine = 'PASS  (the record payout appears in the open sheet)';
    } else if (pay.verdict === 'mismatch') {
      payLine = 'FAIL  (no amount in the sheet matches the record)';
    } else {
      payLine = 'ABSTAINED  (' + pay.why + ' — this gate checked nothing; it does not block)';
    }

    console.log('[EXT] FAST BOOK DRY RUN' +
      '\n      sheet present                 : ' + !!(open && open.present) +
      '\n      selected-card marker          : ' +
        (openWhy === 'no-selected-card'
          ? 'NOT FOUND — the Amazon class changed, see the error above'
          : 'found') +
      '\n' +
      '\n      GATE 1  identity' +
      '\n        bound load id (this panel)  : ' + (boundId || '(missing)') +
      '\n        load id on the SELECTED card: ' + (openId || '(missing)') +
      '\n        ids match                   : ' + match +
      '\n' +
      '\n      GATE 2  payout' +
      '\n        record payout               : ' +
        (pay.recordPayout === null ? '(none captured)' : money(pay.recordPayout)) +
      '\n        amounts read from the sheet : ' +
        (shown.length ? shown.map(money).join(', ') : '(none parsed)') +
      '\n        verdict                     : ' + payLine +
      '\n' +
      '\n      Book button found             : ' + (outcome !== 'no-sheet' && outcome !== 'no-book-button') +
      '\n      outcome                       : ' + outcome +
      '\n      -> ' + (outcome === 'dry-run-would-click'
        ? 'WOULD CLICK  (' + (pay.verdict === 'match'
                              ? 'both gates cleared'
                              : 'identity cleared, payout abstained') +
          '; a real press would book this load)'
        : 'WOULD ABORT  (' + outcome + ' — a real press would NOT click anything)') +
      '\n      NOTHING WAS CLICKED.');
    return {
      boundId: boundId, sheetId: openId, match: match, outcome: outcome,
      markerFound: openWhy !== 'no-selected-card',
      payout: pay.verdict, recordPayout: pay.recordPayout, sheetAmounts: pay.sheetAmounts
    };
  } catch (e) {
    logger.error('inlinePanel', 'fastBookDryRun failed — rehearsal only, the booking path is ' +
      'unaffected', { error: e });
    return null;
  }
};

// Arms a ONE-SHOT corruption of the BOUND id, so the next real press of the Fast Book button
// takes the abort branch. The sheet is untouched and Amazon's DOM is untouched — only our own
// side of the comparison is spoiled, which is the half we are allowed to spoil.
//
// ⚠ It clears itself the instant executeFastBook() reads it, so it survives exactly ONE press,
// and it does not survive a refresh. If it is armed and never used, a reload clears it.
window.__EXT_DEBUG.fastBookForceMismatch = function () {
  logger.log('inlinePanel', 'fastBookForceMismatch called');
  try {
    if (typeof FAST_BOOK_ENABLED === 'undefined' || FAST_BOOK_ENABLED !== true) {
      console.log('[EXT] Fast Book is DISABLED IN THIS BUILD (FAST_BOOK_ENABLED is false). ' +
        'Nothing was armed — there is no press for the flag to affect.');
      return false;
    }
    _fastBookForceMismatchOnce = true;
    console.log('[EXT] FAST BOOK FORCE MISMATCH — ARMED for ONE press.' +
      '\n      Now press the Fast Book button on the open panel.' +
      '\n      Expect: NO booking, the button disabled reading "Blocked — wrong load open",' +
      '\n              and an "executeFastBook: ABORTED" line naming both ids.' +
      '\n      The click is unreachable: the abort returns before bookBtn.click().' +
      '\n      Clears itself after that one press, or on refresh.');
    return true;
  } catch (e) {
    logger.error('inlinePanel', 'fastBookForceMismatch failed — nothing was armed', { error: e });
    return false;
  }
};

