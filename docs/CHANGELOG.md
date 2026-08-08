# Changelog

## [Unreleased]

### 2026-08-08 — id join CONFIRMED CORRECT against live logs (no code change)

**Files: none changed.** This entry records a verification result, not an edit.

**What.** The join was expected to need repointing to a different identifier after a live run
showed **0/50** DOM ids matching any captured response. It did not. A later live run with the
`CITY RAW` / `CITY DIAG` diagnostics in place showed **20/20 captured ids matching**, and the two
id reads were left exactly as they were:

| Side | Exact read |
|---|---|
| DOM | `document.querySelector('div.load-list')` → `.querySelectorAll('div.load-card, div.load-card__selected, div.wo-card-header--highlighted')` → per card `.querySelector('div[id]')` → the **`.id` DOM property** of that child |
| JSON | **`workOpportunities[].id`** |

**Why no change was made.** The repoint was not applied because the premise did not survive
checking. The on-disk paired capture disproved it directly: `samples/paired-card.html`'s
`div[id]` is `72e5184e-7728-4c51-9562-5160c91d4132`, which is exactly
`workOpportunities[3].id` in `samples/paired-search.json`; all 50 ids there and all 50 in
`samples/search-5cities-active.json` are bare UUIDs at that same path. With no evidence of a
different matching field, any repoint would have been a guess — and the live log then confirmed
the existing pair was right all along.

**What actually fixed the 0/50.** Not established. Nothing in the join changed between the two
runs, so the earlier zero was a condition of that session (buffers not matching the rendered
board), **not** a wrong field. Recorded as unexplained rather than credited to this work.

**Known remaining gap, out of scope here:** only ~20 ids are captured (Amazon paginates at 5;
4 buffered pages) against 50 cards on screen, so matches are a subset by design. Page
accumulation is the next step — see STATE.md.

### 2026-08-08 — cityAssign: raw id-shape samples (debug logging only, no behaviour change)

`content/cityAssign.js` (+ raw body, `idSamples` and JSON paths on `networkObserver.js`'s
already-flagged coords message): four `CITY RAW` lines printing both id sets pipe-wrapped, every
id-bearing element and `data-*` attribute per card, two-way containment checks against the raw
body and `document.body.innerHTML`, and a character-by-character diff against the nearest JSON id
— after a live run showed 0/50 overlap across all four buffers. **⚠ Transports the raw response
body while `CITY_ASSIGN_DEBUG` is on** (capped at 500 000 chars, truncation reported), reversing
the "nothing is retained" property for the duration of the debug session only.

### 2026-08-08 — cityAssign: unmatched-card diagnostic (debug logging only, no behaviour change)

`content/cityAssign.js` (+ two counters added to `networkObserver.js`'s already-gated coords
message): four `CITY DIAG` lines and a `CITY DIAG VERDICT` per cycle, distinguishing pagination
(A) from wrong-response selection (B) from missing coordinates (C) as the cause of "id not in any
response" — after a live run showed 6 of 11 cards unmatched, all from one city.

### 2026-08-06 — Per-city load assignment: read-only foundation (SHIPPED OFF)

**New file:** `content/cityAssign.js`. **Touched:** `utils/constants.js`,
`content/networkObserver.js`, `content/originCities.js`, `content/content.js`, `manifest.json`.

**What.** On each completed refresh, assign every on-screen load card to one of the active
origin cities and log the per-city counts:

```
CITY ASSIGN  CHICAGO, IL: 18 | TULSA, OK: 14 | HEBRON, KY: 11 | unmatched: 3
CITY ASSIGN unmatched  a1b2… (no coord in JSON) | c3d4… (id not in any response) | e5f6… (nearest city 877 mi > 150 mi max)
```

**Why.** The board merges all origin cities into one list, and per-city splitting is the goal.
This step proves the assignment is *correct* before anything acts on it. It changes **nothing
the dispatcher sees** — no hiding, no filtering, no reordering, no restyling, no badge, no UI.
Console output only. If the counts are wrong we find out here, at zero risk, instead of after
loads have been hidden from him.

**Flag-gated OFF.** Turning it on is a **four-switch, three-file** operation, because the data
rides on the existing capture path and the output rides on the existing log-level gate:

| # | Switch | File | Ships as |
|---|---|---|---|
| 1 | `DEBUG_LEVEL` → `3` | `utils/constants.js` | `1` — `logger.log` needs ≥ 3 |
| 2 | `CAPTURE_RESPONSES` → `true` | `utils/constants.js` | `false` |
| 3 | `CAPTURE_RESPONSES` → `true` | `content/networkObserver.js` (MAIN mirror) | `false` |
| 4 | `CITY_ASSIGN_DEBUG` → `true` | **both** files above | `false` |

Any one left off makes the feature silent. Deliberate: these log lines contain city names and
work-opportunity ids, and the level gate is the backstop that keeps them out of a stock build
even if a flag is left on by mistake.

**How the assignment works — geometric, never textual.** State formatting in the captured
response is inconsistent *within a single response* (`IL` next to `Ohio` next to `Indiana`), so
string matching would silently mis-assign. Each card's join id is looked up in the captured
`/search` body, and its PICKUP stop's lat/lng is matched to the **nearest active city by
haversine distance**. No city or state string is compared anywhere in the file.

**Plumbing added** (this was **not** free — the coordinates were previously thrown away):
- `networkObserver.js` gained `emitCityAssignCoords()`, which extracts `{id, lat, lng}` triples
  plus `noCoordIds` in the MAIN world and posts them as `__extRelayCityCoords`. The ~300 KB body
  never crosses `postMessage`; only a few KB of triples do.
- `summariseAndDiscard()` is **unchanged to the byte**. Its five-value, no-identifiers contract
  is load-bearing and documented; widening it would have quietly reintroduced exactly what it
  was written to keep out. The new emitter is a separate function on a separate message.
- `originCities.js` gained `getActiveOriginCities()` — a read-only accessor returning a **copy**
  of the last *rendered* city list (not a fresh scrape, so a consumer can never disagree with
  what is on screen). Behaviour otherwise unchanged; nothing in the accessor writes.

**Two values are guesses, recorded as such — tune against real logs:**
- `CITY_ASSIGN_MAX_MILES = 150`. Dispatcher radius has been seen at 25–100 mi. Beyond the
  threshold a card is counted **unmatched rather than forced** onto a city — an unmatched card is
  an honest answer, a wrongly-attributed one is not.
- `CITY_ASSIGN_SETTLE_MS = 700`. The response arrives *before* React renders the cards it
  describes, so the cycle is debounced; this also coalesces the several responses one refresh can
  deliver into a single cycle.

**Cost.** Cards × cities per cycle — ~250 haversines on a 50-card, 5-city board. Pure arithmetic;
the DOM is read once, up front, with `querySelector`/`.id` only — **no layout reads**, so it
cannot make the board janky. City coordinates are resolved through `resolvePATCity()`, which is
**not memoised in `patApi.js`** (every call there is a live fetch, up to 3 with its retries), so
`cityAssign.js` carries its own in-memory cache: each distinct city is resolved **once per page
session**, negative results included. 5 cities refreshing every 20 s = 5 requests total, not 5
per refresh. *Whether that cache should persist across reloads is deliberately left open.*

**Status: UNVERIFIED against a live board.** No TEST_CASES entry yet — there is no user-visible
behaviour to test until the assignment is confirmed correct against real logs.

### 2026-08-05 — Origin city buttons: click disconnected (reserved for filtering) + bigger hit target

**File:** `content/originCities.js`. Two changes to the same element; nothing else in the file.

**CHANGE 1 — renaming hidden, not deleted.** The click on a city is reserved for per-city
filtering in a later task, so it is a **no-op** now.

*Disconnected from `buildCityItem()` — exactly three things:*
1. `item.addEventListener('click', function () { startRenameCity(city); })`
2. the matching Enter/Space `keydown` handler — without removing it the editor would still be
   reachable by keyboard, so "unreachable" would have been false
3. the two-line named render (`ext-origin-driver-name` + `ext-origin-city-sub`), because with no
   way to set a name it could only ever display one restored from storage

The `title` also lost its "(click to rename)" hint — promising an action we no longer perform is
worse than saying nothing. `role="button"`, `tabindex="0"` and the pointer cursor are **kept**:
the element is still a button, awaiting the filtering action the next task attaches.

*Retained, present and callable — verified by invoking it:* `startRenameCity()`,
`commitDriverName()`, `loadDriverNames()`, `ORIGIN_DRIVER_NAMES_KEY`, the `_originNames` cache
(still loaded on every build — the `_originNamesReady` gate depends on it), the
`_originEditingCity` guard in `refreshOriginCities()`, the input CSS, and the
driver-name/city-sub CSS rules. Those last two are currently unused; **kept deliberately** so
re-wiring is the three items above and nothing else. **Stored names are NOT wiped** — a
dispatcher who named cities still has them, and they reappear when the wiring returns.

The harness proves this rather than asserting it: calling `startRenameCity('TULSA, OK')`
directly still opens the editor pre-filled from storage, and committing through it still writes.

**Each button now renders the plain city string**, even when a name is stored — confirmed with
two named cities in storage: single `ext-origin-city-label` child, no driver-name or city-sub
element, `textContent` exactly the city.

**CHANGE 2 — hit target. Final values: `font-size: 14px`, `padding: 8px 14px`.** Was
`font-size: 12px` / `padding: 1px 6px`. The label also gets an explicit `font-size:14px` rule so
its size cannot drift if the pill's own font-size is later changed for another reason. Horizontal
row + wrap layout unchanged; colours still `var(--ext-*)`; `nightMode.js` untouched.

Computed geometry: item **19.0px → 35.5px** tall (14 × 1.25 line-height + 16 padding + 2 border),
about 28px wider than its text.

**⚠️ OVERLAP — the panel got taller and this makes existing overlap worse. Reported, not
silently adjusted.**

| | Before | After |
|---|---|---|
| panel height, 1 row | 33.0px | **49.5px** |
| panel height, 2 rows (wrapped) | ~61px | **91.0px** |

- **BESIDE branch** (centred on the results row via `translateY(-50%)`): the panel now extends
  **±24.8px** from the row's centre on one row, **±45.5px** when wrapped. The results row itself
  is ~32px, so a one-row panel already reaches ~9px below it, and a wrapped one ~29px below.
  **If the gap between the results row and the chip band is under ~9px it will now overlap the
  chips, and a wrapped panel almost certainly will.** I cannot measure that gap without a
  browser, so this is arithmetic plus an unknown, not a conclusion.
- **BELOW branch** (narrow windows, under 200px free to the right — `row.bottom + 6px`): this
  already sat on the chip band. It now covers **~17px more** of it, and a wrapped panel at 91px
  tall could reach past the chips to the first load card.

Neither was adjusted — the task asked for a bigger target and for this to be reported.
TC-ORIGIN-1 step 6 is where the dispatcher judges it.

**Verified — 41 checks, no browser.** Click/Enter/Space produce no input and no listeners are
attached at all; plain city text renders with names in storage; the rename machinery is still
callable and still persists; padding/font-size read from the real stylesheet; row+wrap layout,
tokens-only colours and `nightMode.js` all unchanged; panel still builds, positions and tears
down. One failure during the run was a harness bug — the padding regex matched the rule's own
comment recording the OLD values (`was … padding:1px 6px`) instead of the live declaration.
**Six-point smoke checklist NOT RUN.**

### 2026-08-05 — FIX: origin panel no longer flashes to the corner on every board refresh

**File:** `content/originCities.js`, the not-found branch of `positionOriginPanel()` plus the
cache it reads/writes. Nothing else touched.

**The bug.** Every refresh clears and re-renders Amazon's load list, and the "Showing N results"
row — the panel's anchor — is briefly absent while that happens. The rAF loop found no anchor,
took the not-found fallback, and slammed the panel to `top:8px / left:8px`. A moment later the
row returned and it snapped back. Once per refresh, so continuously while the loop runs.

**The fix — hold the last good position.** A new `_originHasMeasured` flag records whether the
anchor has *ever* been measured successfully. In the not-found branch:
- **measured before** ⇒ `return` immediately, touching nothing. The panel's inline `top`/`left`
  are already right, so leaving them alone *is* holding position.
- **never measured** ⇒ the `top:8px / left:8px` fallback still applies. That is genuine first
  paint, where there is no last-good position to hold.

`_originHasMeasured` is armed only by a real measurement — `applyOriginPosition()` sets it when
`mode !== 'fallback'` — so a first-paint fallback is never mistaken for a good position and is
correctly replaced the moment the row appears.

**No timeout, no retry counter, no visibility toggle.** The hold is a bare early return. The loop
already runs every frame, so a missing anchor for a few frames needs no timing logic — it just
keeps the last value until the anchor is back. Asserted in the harness that none of those
mechanisms exist in the code.

**Logged once, not per frame.** `_originHoldLogged` gates a single `logger.log` on entering a
hold and resets when the anchor returns, so a later gap logs its own line. The
`results-count text not found` **warn** no longer fires during refresh gaps at all — it is now
reserved for the genuine never-measured case, which makes it meaningful again.

**⚠️ Teardown: CLEARED, not carried over — you asked me to confirm which.** `_originHasMeasured`
and `_originHoldLogged` are both reset to `false` in `removeOriginCitiesPanel()`, alongside the
existing `_originLastTop`/`_originLastLeft` reset. Without that, a logout→login cycle would start
with the hold already armed and the previous session's coordinates still cached — so a rebuild
whose anchor had not yet appeared would hold a stale position from a board that may have scrolled
or resized in between. Cleared, the rebuild correctly treats itself as a first paint. Verified by
a logout→login test that asserts the rebuild does **not** restore the old coordinate.

**⚠️ Known remaining path, deliberately not changed.** The `catch` in `positionOriginPanel()`
still applies the corner fallback. It is a different failure mode (an exception during measuring,
not a missing anchor) and the task scoped this fix to the not-found branch. If an exception ever
does fire mid-refresh the panel would still snap. Say the word and it becomes the same two lines.

**Verified — 26 checks, plus 60-check rename and 47-check positioning suites re-run green.**
Removing the results row and pumping **60 frames** (a full second) leaves the position byte-identical
with **zero style writes** and no fallback warn; the row returning resumes measuring; a second gap
logs its own hold; a never-measured panel still takes the corner fallback and is correctly
replaced by a late-arriving row; and the logout→login cycle does not restore a stale coordinate.
One failure during the run was a harness bug matching `retry`/`attempts` inside comments — including
the fix's own comment saying it uses neither. **Six-point smoke checklist NOT RUN.**

### 2026-08-05 — Origin-cities panel: driver-name renaming

**Files:** `content/originCities.js` (feature), `utils/storage.js` (+`ORIGIN_DRIVER_NAMES_KEY`).
Extraction, dedupe, the self-trigger guard, the anchor logic, the rAF loop and teardown are
unchanged apart from two guards and resetting the new state.

**What it does.** Each city pill is clickable. Clicking swaps it for a text input pre-filled with
the current name (empty if unnamed). **Enter or blur commits, Escape cancels, an empty value
clears the name** and reverts the pill to city text alone. Once named the pill shows the driver
name as the primary label with **the city still beneath it**, smaller and muted — the dispatcher
can always see which city a name belongs to.

**⚠️ `var(--ext-text-muted)` does not exist** in `utils/designTokens.js` (0 occurrences). Used
**`--ext-n500`**, the nearest existing muted token and the one this panel's own caption already
uses. No new colour invented, `nightMode.js` untouched.

**Storage.** New `ORIGIN_DRIVER_NAMES_KEY = 'extOriginDriverNames'` — one object, city string
exactly as extracted → driver name. Declared **outside `STORAGE_KEYS`**, deliberately: "Reset to
Defaults" does `chrome.storage.local.remove(Object.values(STORAGE_KEYS))` (`popup.js:617`), and
wiping every driver name on a settings reset would be a destructive surprise. Same reasoning as
`SUPABASE_SESSION_KEY`/`AUTH_PENDING_KEY`. **Entries are never pruned** — a city leaving the
filters keeps its name and comes back labelled.

**No flash.** The first render is deferred until stored names load: `refreshOriginCities()`
early-returns while `_originNamesReady` is false **without recording the signature**, so the
load callback still renders. A storage failure logs with context and renders plain city names.

**Two new guards in the refresh path** — both required, both minimal:
1. `!_originNamesReady` — prevents the raw-city flash above.
2. `_originEditingCity !== null` — **Amazon re-renders the board on every refresh tick**, which
   would otherwise destroy the input under the dispatcher's cursor mid-typing. Neither records
   the signature, so the deferred render lands as soon as the condition clears.

**Keystroke containment — which events and why.** `keydown`, `keypress` and `keyup` are all
stopped at the **panel** element. Amazon's board listens for keys at document level; typing a
driver name must not trigger its shortcuts. All three because handler styles differ — `keydown`
for modern shortcuts, `keypress` for legacy, `keyup` for toggles. **`stopPropagation`, not
`stopImmediatePropagation`**: our own input handlers sit on a descendant and have already run by
the time bubbling reaches the panel, and cancelling them would break Enter/Escape.

**⚠️ Same city in two saved-search tabs — actual behaviour, not a design guess.** Names are keyed
by city string in `chrome.storage.local`, which is **per-profile, not per-tab**. So the name
follows the city: any tab whose filters include `LITTLE ROCK, AR` shows the same driver name.
**But a tab that is already open does not repaint when another tab renames.** There is no
`chrome.storage.onChanged` listener here, so tab B picks the change up only when its own city
list changes or on reload. Adding live cross-tab sync is a small addition following the pattern
`sidebar.js` already uses — **not done, because it was not asked for.**

**⚠️ Max name length: 24 characters**, enforced twice — `maxlength` on the input stops typing, and
a `.slice(0, 24)` on commit stops a paste getting past it. **Layout: the panel GROWS, it does not
truncate.** Each pill is `white-space:nowrap`, the panel is `flex-wrap:wrap` with
`max-width:calc(100vw - 16px)` — so a long name widens its pill, and once the row exceeds the max
width the pills wrap to a second line and the panel grows taller. In the BESIDE branch it stays
vertically centred while growing (`translateY(-50%)`); in the BELOW branch it extends downward
and can reach further over the chip band.

**Verified — 60 checks + a 47-check regression run of the positioning suite, no browser.** Real
module, stub DOM and stub storage: two-line rendering with the city retained; names loaded before
the first render (observer firing early does **not** produce a raw-city render); pre-filled and
empty inputs; Enter/blur commit and persist; **blur after Enter does not double-commit**;
**Escape reverts and writes nothing, and the following blur does not commit the abandoned
value**; empty/whitespace clears the entry; a 60-char paste is sliced to 24; the name survives
the city leaving the filters and a teardown+rebuild; storage failure renders plain names without
throwing; **an open input survives a mid-edit board refresh with the typed value intact**, and
the deferred render catches up after commit; all three key events stopped; teardown leaves
nothing while **stored names survive**. Three failures during the run were harness faults, not
code: a greedy regex spanning the whole file, a stub predating the panel's listeners, and a
baseline captured before the now-deferred first render. **Six-point smoke checklist NOT RUN.**

### 2026-08-05 (later still) — Origin panel: anchored to the results-count line, follows via rAF

Positioning rewrite of `content/originCities.js`. Two parts of the same logic: a new anchor, and
a new update mechanism. Extraction, dedupe, the self-trigger guard and teardown were out of scope
and are unchanged apart from cancelling the new loop.

**Removed:**

| Removed | What it was |
|---|---|
| `findChipElements()` | page-wide scan for laid-out origin-city chips |
| `getChipElements()` + `_originChipEls` | the chip cache |
| `ORIGIN_PANEL_GAP_PX` | the 8px gap under the chip band |
| `positionOriginPanel()` call inside `refreshOriginCities()` | repositioning on the 200 ms debounced path |
| `_originOnReflow`, `_originPosDebounce` | the debounced reflow handler and its timer |
| `window.addEventListener('resize' / 'scroll', …)` | both reflow listeners, and their teardown |

Verified by grep: zero occurrences of any of them remain. Nothing behind a flag or commented out.

**Why the anchor moved off the chips.** The chip band sits *below* the results count, so a panel
glued under the chips sat directly on top of the load list — the previous entry recorded that it
*would* cover the first load card. Anchoring to the results-count line, which sits **above** the
chips, puts the panel in the gap between them instead.

**PART 1 — new anchor.** `findAnchorElement()` matches by TEXT, never class or id: the first
**leaf** element (no element children) whose trimmed `textContent` matches
`/^Showing\b.*\bresults?$/`. `findAnchorRow()` then walks up to the nearest **ancestor** with a
non-zero height — that is the row. Two branches:
- **BESIDE** — vertically centred on the row, left edge at the *text's* right + 16px. Centring
  uses `transform: translateY(-50%)`, so the panel's own height is never measured.
- **BELOW** — when free width to the right is under 200px: `row.bottom + 6px`, aligned to
  `row.left`. Free width is measured against the **viewport**, not the row, because the panel is
  `position:fixed` and the viewport edge is what actually clips it.

Each branch logs once **on transition**, not every frame. Anchor not found ⇒ `logger.warn` with
the pattern and what was missing, plus `top:8px / left:8px`; also applied in the `catch`.

**PART 2 — rAF follow loop replaces the debounce.** The dispatcher collapses Amazon's left filter
panel, the whole board reflows, and the panel is glued to content that moves. A debounced
reposition made it visibly **snap** into place after the reflow finished. The loop reads the
anchor rect every frame and writes `top`/`left` only when either changed by more than **0.5px**,
so it travels with the content instead. Started in `buildOriginCitiesPanel()`, cancelled in the
existing teardown.

**The resize and scroll listeners were removed as redundant, not merely superseded** — both
existed only to signal "the anchor may have moved", which the loop now observes directly.

`refreshOriginCities()` is back to being purely about the list: its early-return on an unchanged
signature is untouched, and it no longer positions anything.

**⚠️ MEASURED COST PER FRAME — asked for explicitly.** Steady state is **2 `getBoundingClientRect()`
calls and 0 style writes**, counted by the harness over 10 frames (20 reads / 0 writes).
- The anchor is **CACHED** (`_originAnchorEl`). It is **not** re-queried per frame — a
  full-document `querySelectorAll('*')` at 60fps would be indefensible. Measured: **zero**
  rescans across 10 steady frames on a 40-chip page.
- The rescan runs only when the cached node leaves the DOM (Amazon's React re-render); the
  harness confirms exactly one rescan in that case.
- It was **3** reads per frame in first draft — `findAnchorRow()` measured the row and the caller
  measured it again. `findAnchorRow()` now returns `{ el, rect }` so the caller reuses it.
- A still board costs **zero** style writes, so no layout is invalidated when nothing moves.
  Sub-0.5px jitter is also confirmed not to write.

**⚠️ OVERLAP — reported, not silently adjusted.**
- **Results-count text:** cannot overlap it in the BESIDE branch — the panel starts 16px to its
  right. In the BELOW branch the panel drops under the whole row, so it clears the text too.
- **Chip band:** **YES, it can overlap.** In the BELOW branch the panel is placed at
  `row.bottom + 6px`, which is exactly where the chips live. At narrow widths (under ~200px free
  to the right) the panel will sit on top of the chip band. It no longer reaches the load cards,
  which was the point, but it has traded that for covering the chips in the narrow case.
- **Sort control:** unknown. Its position relative to the results-count row has never been
  captured, so I cannot say whether it sits inside that row to the right. If it does, the BESIDE
  branch would cover it. **Flagged for the dispatcher rather than guessed at** —
  TC-ORIGIN-1 step 6.

**Verified — 47 checks, no browser.** Real module, stub DOM with real rects and a manually pumped
rAF so frames are deterministic: both branches and their exact arithmetic; `Showing 1 result`
(singular) and `Showing 1-50 of 338 results` both anchoring while `Showing results for your
search` correctly does not; anchor-missing fallback with the warn logged once rather than every
frame; following within a **single frame** when the board shifts 240px; the cost counters above;
the render path no longer positioning; and teardown leaving **zero** queued frames with a rebuild
restarting exactly one loop. Two failures during the run were a genuine spec mismatch I fixed in
the code (`findAnchorRow` started at the element instead of its parent, centring on the text
rather than the row); one was a harness bug matching `setInterval` inside a comment.
**The six-point smoke checklist is NOT RUN.**

### 2026-08-05 (later) — Origin-cities panel REPOSITIONED: measured placement, horizontal layout

Layout and position rewrite of `content/originCities.js`. **The old positioning is deleted, not
disabled.** Extraction, dedupe, the self-trigger guards and teardown were explicitly out of scope
and are unchanged.

**Removed:**

| Removed | What it was |
|---|---|
| `left:12px; bottom:12px` on `#ext-origin-cities` | the bottom-left corner pin |
| `flex-direction:column; gap:4px` on the list | the vertical stack |
| `max-height:40vh; overflow-y:auto` on the list | scroll containment, only needed by a tall vertical stack |
| `min-width:150px; max-width:230px` on the panel | narrow-column sizing, wrong for a horizontal band |
| `margin-bottom:6px` on the title | the block heading's spacing above its own line |
| `overflow:hidden; text-overflow:ellipsis` on each city | per-row truncation inside a fixed-width column |

Nothing kept behind a flag or commented out. Verified by grep: no `bottom:` offset, no
`flex-direction:column`, no `max-height:40vh`, no `min-width:150px`/`max-width:230px` remain.

**New layout — horizontal.** The panel is a wrapping flex **row**: the `ACTIVE ORIGIN CITIES`
caption sits **inline at the left** (`flex-shrink:0` so it stays whole), then the cities left to
right, wrapping to a second row only when they do not fit. `max-width:calc(100vw - 16px)` bounds
it. Each city gained a subtle token-coloured pill — a deliberate readability call, because city
values contain their own comma (`LITTLE ROCK, AR`) and read as one run-on string when separated
by whitespace alone.

**New position — measured, never hardcoded.** `positionOriginPanel()` runs on every render:
collect every element whose trimmed `textContent` starts with `"Origin city: "` (the same text
anchor `readActiveOriginCities()` uses — Amazon's container is never queried by class or id),
walk **up** from each to the first ancestor with a non-zero `getBoundingClientRect().height`
(the `<span>` itself is usually a zero-height inline node), then take the **largest bottom** and
the **smallest left** across them. `top = bottom + 8px`, `left = smallest left`. Panel stays
`position:fixed` and is never inserted into Amazon's DOM.

**Why measured rather than a fixed offset:** the band's height is not a constant. Chips wrap to a
second row on narrow windows, and the band moves with page scroll — so any hardcoded top would
detach from it. Largest-bottom is what handles the wrap case; the lowest row is the one that must
be cleared.

**Fallback:** if no chip resolves to a laid-out element, `logger.warn` with the candidate count
and `top:8px / left:8px`. Also applied in the `catch`, because an unset `top`/`left` on a fixed
element renders it at its static position — overlapping page content at the origin.

**Reflow handling.** Position is recomputed on the existing 200 ms-debounced observer, plus
**debounced `resize` and `scroll` listeners** — no second observer. `scroll` uses capture
(`true`): scroll events from an inner scrolling container do not bubble but do pass through the
capture phase at `window`, which catches the load list scrolling without querying Amazon's
container. Those two use their own timer so a scroll tick only re-measures rects instead of
re-running the page-wide span scan. A small cache of the resolved chip elements is reused while
they stay `isConnected`, and dropped when the list changes or any node is unmounted.

**One structural change to `refreshOriginCities()`, deliberately:** the list-change guard now
gates **only the render**, and `positionOriginPanel()` runs unconditionally. The band moves on
scroll, resize and wrap — none of which changes the list — so gating position on the signature
would leave the panel detached. The render guard itself is untouched, and repositioning writes
only inline `style.top`/`left`, an **attribute** mutation, which the `childList`+`subtree`
observer does not watch. No feedback loop.

**⚠️ Z-INDEX AND OVERLAP — reported, not silently adjusted.**
- Panel `2147483646`; sidebar `2147483647` — **the sidebar wins**, by one, as before.
- **Against Amazon's filter band: unknown.** No capture of Amazon's own z-index exists anywhere
  in this repo (checked `samples/` and AMAZON_SELECTORS.md). `2147483646` is one below the 32-bit
  maximum and will realistically sit above anything Amazon uses, but that is **inference, not
  evidence**.
- **YES — the panel can now cover a load card.** It sits fixed 8px below the chip band, which is
  directly above the load list, and it is out of document flow so nothing reflows around it. On a
  narrow window both the chips *and* the panel wrap to two rows, pushing it further down over the
  list. It will overlay the top of the first load card at small window sizes. That is the direct
  consequence of "directly below the filter band" + `position:fixed`, and it is **not** adjusted
  here. TC-ORIGIN-1 step 6 asks the dispatcher to judge it.

**Verified — 45 checks, no browser.** Drives the real module against a stub DOM with real rects:
measured placement, the **wrapped-chips case** (lowest bottom / smallest left win, not the first
chip), the zero-height-span walk-up, the fallback (warn + 8/8, no throw), debounced scroll and
resize repositioning, the render guard still firing zero extra renders on an unchanged list while
the panel still repositions, teardown removing both reflow listeners with no resurrection, and
that extraction/dedupe/empty-state are unchanged. **The six-point smoke checklist is NOT RUN.**

### 2026-08-05 — NEW: floating "Active origin cities" panel (step 1 of the multi-driver monitor)

**New file `content/originCities.js`**, plus three wiring edits: `manifest.json` (script listed
before `content.js`), and `content/content.js` — `buildOriginCitiesPanel()` in
`activateExtensionUI()`, `removeOriginCitiesPanel()` in `deactivateExtensionUI()`.

**What it does.** A small fixed panel, bottom-left, listing the origin cities currently active in
Amazon's load-board filters, updating live as the dispatcher adds or removes them.

**Extraction is text-based, never class-based (requirement 1).** The chips are
`div.css-1w1nhw5 > div.css-e7fmj9 > span` — all generated CSS-in-JS hashes. `readActiveOriginCities()`
collects every `<span>` whose **trimmed** `textContent` starts with `"Origin city: "` and slices
off the prefix. Two details that are not obvious and are covered by tests:
- **trims first** — Amazon ships stray whitespace on this board (the Filter button's `aria-label`
  is literally `"Filter  "`, see AMAZON_SELECTORS.md), so an untrimmed `startsWith` would miss chips
- **de-duplicates** — a nested outer `<span>`'s `textContent` also starts with the prefix, so the
  same chip can match twice

**Placement.** Bottom-left deliberately: the sidebar is fixed top-centre and Amazon's own refresh
control is bottom-right (`refreshManager.js`), so bottom-left is the only corner colliding with
neither. `z-index` one below the sidebar's.

**Night mode required no work and `nightMode.js` was NOT touched.** Every colour is a
`var(--ext-*)` token, and those already carry `html.ext-night` overrides in `designTokens.js`.

**Live updates** via a 200ms-debounced `MutationObserver` on `document.body`, anchored there for
the same reason `loadObserver.js` is (React unmounts the filter containers). **Two self-trigger
guards**, because our own render mutates the DOM the observer watches: mutations originating
inside the panel are skipped, and a re-render happens **only when the extracted list actually
changed**. The second makes a feedback loop impossible independently of the first.

**Existing functionality protected — three things worth calling out:**
1. **`buildOriginCitiesPanel()` swallows its own errors.** `activateExtensionUI()` rolls the whole
   activation back if a step throws (the 2026-07-30 lockout fix), so a failure in a secondary
   panel must not cost the dispatcher the sidebar and the monitoring loop. It degrades to "no
   panel" instead.
2. **Teardown is wired into `deactivateExtensionUI()`.** Without it, logging out would leave a
   floating panel *and a live MutationObserver* on the page, breaking the documented "reverted to
   fully untouched" guarantee.
3. **The panel id starts with `ext-`**, so `loadObserver.js`'s `isExtManagedNode()` already skips
   it and our own injection cannot wake the detection pipeline.

**Read-only with respect to Amazon.** No `.click()`, no writes to Amazon's DOM, no requests — so
no new SAFETY.md click site, and `FORBIDDEN_SELECTORS` is untouched.

**Verified — 44 checks, no browser.** Drives the real module against a stub DOM: extraction
(prefix match, trim, nested-span de-dup, non-matching spans ignored, empty case), injection
(idempotent, one stylesheet, every element carries a `data-testid`, **no `innerHTML` used
anywhere**), live add/remove/empty transitions through the observer, the self-trigger guard
(repeated fires with an unchanged list produce **zero** re-renders), teardown (panel, stylesheet
and observer all gone; no resurrection; safe twice; rebuild works), and that a thrown DOM error
is swallowed and logged. **The six-point smoke checklist is NOT RUN.**

### 2026-08-05 — DOCS ONLY: Single-Tab Multi-Driver Monitor recorded as future work

**No code changed. Nothing built. No task, test case or stub created** — deliberately, per the
instruction. This entry exists because this project logs every change to the doc trail.

A new post-launch feature is now defined and evidence-backed in the docs: one Relay tab monitors
several drivers in different regions using Amazon's five-city multi-origin search, splitting the
merged list into per-driver sub-tabs with per-tab new-load counters and a colour stripe on the
combined view. It removes the *cause* of multi-tab rate limiting (N tabs → N request streams from
one IP) rather than managing the symptom.

**Files written:** `docs/BACKLOG.md` (the feature block, five numbered findings, constraints),
`docs/PRODUCT.md` (**new file** — did not previously exist), `docs/api-samples.md` (§6, captured
evidence), `STATE.md` (future-work entry only — **current phase deliberately unchanged**),
`docs/GLOSSARY.md` (three new terms).

**⚠️ Provenance is recorded per-finding, because it is uneven.** The 2026-08-05 five-city capture
(LITTLE ROCK / CHICAGO / TULSA / HEBRON / JACKSONVILLE, radius 25, 104 results) **is not in
`samples/`**. Verified against the on-disk captures: the absence of any origin-attribution field
(every candidate keyword walked; only `searchAuditId`, the load's own `domicile` fields,
`matchDeviationDetails` and `searchChannelStampedDuration` exist, none naming a searched city),
and the pickup-coordinate path `loads[0].stops[0].location.latitude/longitude` (populated 50 of
50, `stopType "PICKUP"`, `stopSequenceNumber 1`). **Partly** verified: state-string inconsistency
— `"IL"`/`"Ohio"`, `"IN"`/`"Indiana"`, `"KY"`/`"KENTUCKY"` seen directly, `"FL"`/`"Florida"` not
(no Florida record on disk). **Not** verified: that one refresh fires multiple `/search` calls
(104 + 11-with-null-payout). That last one is the most likely source of a wrong-data bug and
should be captured before any build starts.

### 2026-08-05 (later) — Filters-panel collapse REWRITTEN: presence test replaces layout measurement

**This replaces the implementation added earlier the same day. The old one is deleted, not
disabled.**

**Why the old approach failed.** It could not read the panel's state, so it clicked first and
measured afterwards: a load card's `getBoundingClientRect().left` before and after, a 20px dead
band, and — when the measurement showed it had *opened* a panel that was already collapsed — a
**second click to undo itself**. Functionally self-correcting, visually unacceptable: the panel
**flashed open and shut** every time the dispatcher pressed START with the filters already
collapsed. It was also inherently fragile, since it inferred state from pixels across arbitrary
monitors and zoom levels.

**What replaced it.** Amazon **removes `div.filters__column` from the DOM** when the panel is
collapsed (captured live 2026-08-05, both states, same session, no reload). So presence *is* the
state:

1. `document.querySelector('div.filters__column')` — absent ⇒ already collapsed, `logger.log`,
   **return without clicking**
2. Find the button (`[role="img"][aria-label]` trimmed to `Filter`, then `.closest('button')`) —
   absent ⇒ `logger.warn` with context, return
3. `isForbiddenElement(btn)` ⇒ `logger.error`, return
4. `btn.click()`, `logger.log`, return true

**Exactly one click, only when the panel is confirmed open. No verification pass, no second
click, no flash.**

**Deleted from `content/panelCloser.js`** (the orphan sweep the task asked for):

| Removed | Why it existed |
|---|---|
| `collapseFilterPanel()` — the whole async body | the measurement implementation |
| `FILTER_ANCHOR_SELECTORS` | measurement anchor list |
| `findFilterAnchor()` | measurement anchor lookup |
| `DEAD_BAND` (20px) | measurement tolerance |
| `before` / `after` locals, the delta arithmetic | measurement |
| the `requestAnimationFrame` + 350ms settle wait | waiting for layout to settle |
| the `anchor.isConnected` re-query | re-finding a node detached by the re-render |
| `async` / `await`, and the `.catch()` at the call site | the function no longer returns a Promise |

**Nothing was kept as a fallback, a flag, or a commented-out copy.** Verified by grep: zero
occurrences of any identifier above remain anywhere in `content/`, `utils/` or `background.js`.
`getBoundingClientRect` still appears twice in the file — both inside the **pre-existing**
`findDetailCloseButton()`, which is unrelated to this path and untouched.

**Net line count: `content/panelCloser.js` 210 → 161 lines (−49).** The deletion removed 109
lines; the replacement added 60. It did shrink.

**Call site unchanged:** still the existing `closePanelsForStart()`, still fired once per loop
start on `val === true` only. The invocation form changed from fire-and-forget-with-`.catch` to a
plain call in a try/catch, because the function is synchronous now — that try/catch also keeps a
filters-panel failure from stopping the detail-sheet close that follows it.

**Registry:** `CLOSE_FILTER_PANEL` in `ALLOWED_CLICK_INTENTS` and the SAFETY.md click site were
already restored by the previous task and were **not duplicated** — verified one occurrence each.
The SAFETY.md section itself **was** corrected: it described the two-click revert as current
behaviour, which is no longer true. `FORBIDDEN_SELECTORS` untouched.

**Verified — 38 checks, no browser.** Drives the real rewritten function: panel open ⇒ exactly
one click; panel absent ⇒ **zero** clicks and the button is never even looked up; button missing
⇒ warn, zero clicks; `isForbiddenElement` ⇒ error, zero clicks; a filters no-op still lets the
detail sheet close. The harness also **throws if the code touches `requestAnimationFrame`,
`setInterval` or `MutationObserver`**, and records any `getBoundingClientRect` call — **zero
layout reads occur on this path in any scenario.** Plus hygiene assertions that every deleted
identifier is gone. **The six-point smoke checklist is NOT RUN.**

### 2026-08-05 — Filters panel auto-collapses on START (unblocked after 3 failed attempts)

**What:** pressing START on the sidebar now collapses Amazon's left filters panel. It is never
reopened automatically — not on stop, pause, resume, or page load.

**Files:** `content/panelCloser.js` (new `collapseFilterPanel()`, called from the existing
`closePanelsForStart()`), `utils/constants.js` (`CLOSE_FILTER_PANEL` restored to
`ALLOWED_CLICK_INTENTS`), `docs/SAFETY.md` (click site re-authorized as Click 4; Fast Book
renumbered to Click 5).

**Why it was blocked, and what unblocked it.** Three attempts in June 2026 were built and
removed because none could read whether the panel was open. Captured live 2026-08-05: the Filter
button's attributes are **byte-identical open vs collapsed** (`type="button"`,
`mdn-popover-offset="-9"`, `class="css-14evw8c"`) and carry **no `aria-expanded`**. There is no
state to read, which is why every prior attempt stalled.

**The mechanism is a measurement, not a lookup.** An open panel occupies horizontal space on the
left, so the load list sits further right; collapsing it moves the list left. `collapseFilterPanel()`
reads the first `div.load-card`'s `getBoundingClientRect().left` before and after clicking, waits
one `requestAnimationFrame` plus 350ms for layout to settle, then decides with a **20px dead band**:

| Measurement | Meaning | Action |
|---|---|---|
| `after < before − 20` | collapsed as intended | `logger.log`, return `true` |
| `after > before + 20` | **we opened it** — it was already collapsed | **click once more to revert**, `logger.warn`, return `false` |
| within ±20 | no layout change | `logger.warn` with both numbers, **do NOT click again**, return `false` |

**The self-correcting revert is the whole design.** Because the starting state is unknowable, the
click may be wrong — and the measurement detects exactly that and undoes it. This makes the
feature safe without ever knowing the panel's state, which is precisely what three earlier
attempts could not achieve. In the ambiguous third case we deliberately do **not** click again: a
second click on an unknown state is the blind toggle this design exists to avoid.

**Never blocks START.** `closePanelsForStart()` fires it and does not await it (it waits ~350ms),
with a `.catch` so a rejection can never surface on Amazon's page. Guarded by
`isForbiddenElement()` before the click, like every other click site. Button missing, or no load
card to measure against ⇒ `logger.warn` and **zero clicks**.

**Selector:** `aria-label` is on the inner `<span role="img">`, not the button — the reason all
three prior attempts' `button[aria-label="Filter"]` matched nothing — and it carries trailing
spaces (`"Filter  "`), so the comparison is trimmed. No dependency on the `css-14evw8c` hash;
it appears only in comments as captured evidence. Full record in AMAZON_SELECTORS.md.

**Untouched as required:** `FORBIDDEN_SELECTORS`, no MutationObserver or polling, no persistence
of panel state, no second call site, no reopen on any event.

**Verified — 42 checks, no browser.** Drives the real `collapseFilterPanel()` through every
branch of step 5 including both dead-band boundaries (−20.1px collapses, +20.1px reverts, ±20px
exactly does neither), the already-collapsed revert (asserting exactly **two** clicks), button
missing, no anchor, `isForbiddenElement` blocking (all asserting **zero** clicks), and the anchor
detaching mid-flight. Plus call-site checks: one call site, not awaited, `.catch` present, still
only in the `val === true` branch. **The six-point smoke checklist is NOT RUN.**

### 2026-07-31 (later) — Inline-panel #F5F5F5 moved from the body to the header

One change, two selectors. `#F5F5F5` had been applied to the wrong surface on 2026-07-31; the
dispatcher confirmed the intended target was the segment **header**.

| File | Selector | Was | Now |
|---|---|---|---|
| `utils/designTokens.js:48` | `--ext-leg-header-bg` (sole consumer: `.ext-seg-header`) | `#CFDBFB` | **`#F5F5F5`** |
| `content/inlinePanel.js:209` | `.ext-seg-body` | `#F5F5F5` | **`#FFFFFF`** (restored) |

**⚠️ One premise in the task did not hold, so edit 1 landed elsewhere than instructed.** The
header background is **not** a literal inside `injectPanelStyle()` — `inlinePanel.js:96` reads
`background:var(--ext-leg-header-bg)`, with the value in `utils/designTokens.js`. Only the body
colour is a literal. Changing the token was chosen over replacing the `var()` with a hex, because
the token is the existing mechanism, its sole consumer is that one rule, and inlining would have
left `--ext-leg-header-bg` defined but unused. No new stylesheet, no `!important`, and
`nightMode.js` untouched.

**Night-mode check (asked for explicitly): the override EXISTS.** `content/nightMode.js:130-131`
carries `html.ext-night #ext-inline-panel .ext-seg-header{ background-color: DK_HIGH !important; }`.
Dark mode is therefore unaffected by this move and nothing was invented. `.ext-seg-body` has the
same protection at `nightMode.js:224`.

**Contrast — the move FIXES both regressions the previous placement introduced.** Recomputed to
WCAG 2.1 with colours read from source (bar is 4.5:1; every one of these is under 18px, so the
large-text 3:1 allowance does not apply):

| Text | Was | Now | |
|---|---|---|---|
| `.ext-seg-dist` / `.ext-route-arrow` / chevron `#4A6570` on the header | 4.48 (**FAIL**) | **5.69** | ✅ fixed |
| `.ext-seg-header` base + route codes `#1F3A45` on the header | 8.68 | **11.01** | ✅ |
| `.ext-stop-addr` `#6B7280` back on `#FFFFFF` | 4.43 (**FAIL**) | **4.83** | ✅ fixed |
| `.ext-inline-panel__table td b` `#111827` on the body | 16.27 | **17.74** | ✅ |

**Zebra striping: restored, not rescued.** `var(--ext-n100)` = `#f5f7fa` on `#FFFFFF` measures
**1.073:1**, up from 1.016:1 on `#F5F5F5`. That is its original designed value — but it is a very
subtle tint either way, and "legible" would be overclaiming. It is decorative banding, not text,
so no WCAG text bar applies.

**⚠️ New side effect to eyeball — the header/body seam is now nearly invisible.** `#F5F5F5`
header against `#FFFFFF` body is **1.090:1**. Previously the blue `#CFDBFB` header read as a
distinct band; now the only thing separating header from body is `.ext-seg-header`'s existing
`border-bottom:1px solid #C4D2D6`. Not changed — it was not in scope — but the dispatcher should
confirm the header still reads as a header. See TC-PANEL-COLOUR-2 step 4.

**Verified:** 6 structural checks (token value, body value, `#CFDBFB` fully gone, no `!important`
on either rule, `nightMode.js` unmodified, night override present) plus the contrast table above,
all computed from the real source files. `node --check` passes on both files. **No browser — the
six-point smoke checklist is NOT RUN.**

### 2026-07-31 — SESSION SUMMARY & HANDOVER INDEX

Index of the 2026-07-31 session for an incoming project manager. Individual entries below carry
the detail; this exists so nobody has to infer verification status from prose. **Read STATE.md's
HANDOVER block first — it is the authoritative current state.**

**Git:** most of this session is committed as `9673465`. The **response-body capture is still
uncommitted** (`content/networkObserver.js`, `utils/constants.js`, `content/content.js`), as is
this handover. **`samples/` is gitignored** — the raw captures do not survive a clone; the written
findings in STATE.md are the surviving record. See STATE.md's HANDOVER block.

**Verification vocabulary used throughout this file, so it is not misread:**
"Verified" in an individual entry means *verified by a Node harness against real source files* —
never in a browser. **No agent has run a browser at any point this session.** The six-point smoke
checklist in `docs/CLAUDE.md` was **NOT RUN** for any change below. "Verified by the dispatcher"
means a human exercised it on the live board.

| Change | Code state | Dispatcher-verified? | Outstanding test |
|---|---|---|---|
| PAT: unparseable distance/stop count gate Confirm with warnings | in tree | ✅ **yes** | — |
| Logger level-gating (ships at `DEBUG_LEVEL = 1`) + PII sweep (email, addresses) | in tree | ✅ **yes** | — |
| `EXT_NAME` → `Torren Relay` | in tree | ✅ **yes** | — |
| Activation lockout (`_extActivated` set only after all init succeeds) | in tree | ✅ **yes** | — |
| Popup renders from local session; network failure no longer signs out | in tree | ✅ **yes** | — |
| Rate limiting: only 429/502/503/504 back off; aborts never reported | in tree | ❌ **no** | **TC-RATELIMIT-7** |
| **502 + 504 added** to `RATE_LIMIT_STATUSES` → `[429, 502, 503, 504]` | in tree | ❌ **no** | **TC-RATELIMIT-7 step 7a** |
| Payout selector widened (`wo-total_payout__match-deviation-attr`) | in tree | ❌ **no** | **TC-PARSE-2** |
| Auto-refresh stop moved into the click handler (guard-3 regression) | in tree | ❌ **no** | **TC-PANEL-2B** |
| Flag-gated response-body capture | in tree, **SHIPPED OFF** | ❌ **no** | **TC-CAPTURE-1** |
| Sidebar paused/rate-limit message removed | in tree | ❌ **no** | **TC-RATELIMIT-6** |
| Accordion leg-header colour `#CFDBFB` | in tree | ❌ **no** | **TC-PANEL-COLOUR-1** |
| Inline panel `#F5F5F5` on `.ext-seg-body` | in tree | ❌ **WRONG ELEMENT** | **UNRESOLVED — see BACKLOG.md** |

**On the 502/504 question specifically, since it was asked directly: YES, they were added.**
`background.js` now reads `const RATE_LIMIT_STATUSES = [429, 502, 503, 504];`. This was a
deliberate safety-side default taken **without captured evidence** that Amazon throttles via a
gateway status — the reasoning (asymmetric cost: an un-backed-off throttle risks a real IP block,
an ordinary gateway error costs a few seconds) is recorded in the comment at the constant.
**500 is deliberately excluded.**

**`CAPTURE_RESPONSES` lives in TWO files and both must be flipped together** — `utils/constants.js`
and the MAIN-world mirror in `content/networkObserver.js`. **Both must be `false` before any
build.** See STATE.md.

**Reconnaissance results are recorded in STATE.md's HANDOVER block, not only here** — they cost a
full day and must not be buried in a changelog. Headline: the join key is proven, both endpoints
paginate at page size 50, price-per-mile is derived, and the decision is a **narrow hybrid** (DOM
remains the source of truth for what is on screen; JSON is looked up by id for the clicked load
only). Full JSON rendering is a **NO-GO**.

**Three items are open and blocked**, each on a single missing capture — filters-panel
auto-collapse, the inline panel colour target, and R-type (own-trailer) PAT posting. All three are
written up in BACKLOG.md with exactly what unblocks them.

### 2026-07-31 — Flag-gated response-body capture (capture & discard, shipped OFF)

The agreed proving step: read the body on a live board and throw it away, so the read is
proven harmless before anything depends on it. **Renders nothing, stores nothing.**

**Three files.** `utils/constants.js` (+`CAPTURE_RESPONSES = false`),
`content/networkObserver.js` (the capture), `content/content.js` (+one **separate** message
listener — deliberately not a branch inside the existing REPORT_RESULT relay, so that relay's
diff stays at zero lines).

**⚠️ Two constraints the task spec did not account for, both resolved:**

1. **The flag is a TWO-FILE edit.** `networkObserver.js` is the one content script running in
   the page's **MAIN world**, so it cannot see `constants.js` — isolated-world globals do not
   exist there. It carries a mirrored `CAPTURE_RESPONSES`, exactly as `background.js` already
   mirrors `RATE_LIMITER_KEY` for the same reason. **The mirror is the copy that gates the body
   read.** Both constants cross-reference each other; flip both.
2. **`logger` does not exist in the MAIN world either.** So the summary is `postMessage`d to the
   isolated world as five counters and logged there with `logger.log` — which is what makes it
   level-gated. Requirement 4 (silent at `DEBUG_LEVEL = 1`) is met, and there is a useful
   belt-and-braces effect: the isolated side also checks `CAPTURE_RESPONSES`, so leaving the
   MAIN mirror on by accident still produces no output in a stock build.

**Capture scope is separate from `WATCH_PATH`, on purpose.** `WATCH_PATH` is
`/api/loadboard/search` only and drives rate-limit reporting; widening it to `/similar` would
start feeding similar-endpoint failures into `background.js`'s backoff — a behaviour change,
explicitly out of scope. A distinct `CAPTURE_PATHS` list covers the two capture endpoints and
nothing else. Verified: with the flag on, `/similar` produces a capture summary and **no**
rate-limit report.

**fetch:** clones as the *first* statement of the handler, before `resp.ok`/`resp.status` are
read, so no later edit above it can disturb the body first; reads the clone via `.text()`
(consumes fully, so neither branch stays buffered); never touches the original; still returns the
original promise. **XHR:** no clone needed (reads are non-destructive); branches on
`responseType` — `responseText` for `''`/`'text'`, `.response` for `'json'`, everything else
skipped. Every observation path is wrapped so nothing reaches Amazon's promise or handler.

**Untouched, as required:** `reportResult`, the rate-limit path, abort handling, and how
`ok`/`status` are reported. Proven by an A/B against the committed file (below).

**Log line** is one `logger.log`, counters only: endpoint, `workOpportunities.length`,
`totalResultsSize`, `nextItemToken`, body length. No ids, cities, addresses or payouts — asserted
by the harness against the real 307 kB capture.

**Verified — 38 checks, no browser.** Drives the **real** `networkObserver.js` in a vm with
Node's WHATWG `Response` and the real `samples/paired-search.json`:
(b) the **double-read failure is reproduced first** — `Response` body read twice throws — so
nothing below passes vacuously; (a) clone-before-read works and the **original still parses to
all 50 work opportunities** afterwards; (c) a handler registered inside the wrapper runs before
one attached after it; (d) **flag OFF emits a byte-identical postMessage stream to
`git show HEAD:content/networkObserver.js`**; (e) all three of `''`/`'text'`/`'json'` capture
without throwing, plus a positive check that `responseText` **does** throw for `'json'` (proving
the branch is load-bearing) and that `'blob'` is skipped silently. Also: aborts still report
nothing with capture on, non-loadboard URLs are untouched, and the file contains no `loadStore`,
no `chrome.storage`, and no module-level cache.

### 2026-07-31 — RECON part 3 (no code changed): paired DOM+JSON capture

`samples/paired-card.html` + `samples/paired-search.json`, captured together. Settles three
open items from the earlier recon.

**1. JOIN KEY — PROVEN.** The card's inner `<div id="72e5184e-7728-4c51-9562-5160c91d4132">`
is `paired-search.json` → `workOpportunities[3].id`. **Thirteen values cross-checked, zero
mismatches**, all agreeing at display precision:

| Field | Card | JSON |
|---|---|---|
| payout | `$736.93` | `payout.value` 736.9291422064108 → **736.93** |
| price/mile | `$2.35/mi` | payout ÷ totalDistance = 2.3472… → **2.35** (confirms the derived-field claim) |
| distance | `314.0 mi` | `totalDistance.value` 313.9602154751699 → **314.0** |
| deadhead | `33.89 mi` | `deadhead.value` 33.88899020762622 → **33.89** |
| stop count | 2 | `stopCount` 2 |
| origin | `XMD2 JOLIET, IL 60436-8548` | `startLocation` stopCode/city/state/postalCode — exact |
| destination | `CMH3 MONROE, OH 45050-1848` | `endLocation` — exact |
| duration | `7h 6m` | `totalDuration` 25,560,000 ms = 7.10 h |
| STARTING_SOON | badge present | `tags` = `["STARTING_SOON","PUSH_NOTIFICATION_ENABLED"]` |

Three agree only after transformation, and that transformation cost is real: **times** are
local-formatted on the card (`Mon Aug 3 18:24 CDT`) vs UTC in JSON (`2026-08-03T23:24:00Z` —
correct, CDT = UTC−5); **equipment** is `53' Trailer` vs enum `FIFTY_THREE_FOOT_TRUCK`; and
**loading type** is a single `Drop` on the card vs per-stop `loadingType:"PRELOADED"` +
`unloadingType:"DROP"`. That last one is **not 1:1** — the board's four documented labels
(Drop / Live / Live/Drop / Drop/Live) must be derived from the stop sequence, and one card
cannot establish that rule. Observed sequences in this file: 43× `PRELOADED→DROP`,
6× doubled, 1× `PRELOADED→LIVE→LIVE`.

**2. TRAILER "P" — NARROWED, NOT SETTLED.** This card **has** the badge and its record carries
`loads[0].stops[0].trailerDetails[0].assetOwner = "AZNG"` (pickup stop only; the dropoff stop's
`trailerDetails` is `[]`). Consistent with `AZNG → P`, but it is a **positive-only** observation:
no card without the badge has been captured. Distribution in this file: 42/50 `["AZNG"]`,
5 `["NCSL"]`, 2 mixed, 1 `["HUBG"]`. The decisive capture is a card **without** the P badge —
candidates already identifiable in this same file, e.g. `31e38152-e11b-4a04-8cc7-5ae71784aff7`
(NCSL, WIL4→IND1, $654.64) or `5aa112da-cbbd-43f4-9b39-6d09e509a9f5` (HUBG, XIN5→MIA1,
$2,758.13).

**3. /search PAGINATION — GAP CLOSED. It paginates.** `workOpportunities.length` **50**,
`totalResultsSize` **338**, `nextItemToken` **50** (307,003 bytes). Page size 50, same as
`/similar`; 338 results ≈ 6.8 pages. The Q5 conclusion from the earlier recon — one response is
one page, so a JSON store would diverge from the rendered board — is now **proven for the main
board feed**, not merely assumed from the similar endpoint.

**Go/no-go unchanged: NO-GO on full JSON rendering, conditional GO on narrow detail
enrichment.** The join key being proven strengthens the enrichment path (it is the mechanism
that path depends on); the pagination confirmation strengthens the case against JSON as the
board's source of truth.

### 2026-07-31 — RECON (no code changed): can the inline panel render from Amazon's JSON?

Analysis only against `samples/search-1.json`, `search-2.json`, `similar-1.json`. **Verdict:
NO-GO on full JSON rendering; conditional GO on a narrow detail-enrichment path.** Decided not by
the three unknown fields (which mostly resolved) but by pagination and memory — see below.

**Sample-file corrections (the brief's descriptions did not match the files):** `samples/README.md`
and `samples/similar-empty.json` are **absent**. `search-1.json` is the **empty** case
(`totalResultsSize: 0`, 0 work opportunities), not "small result set". `search-2.json` has
`nextItemToken: null` / `totalResultsSize: 4` / 4 WOs — it is **not** the pagination case.
`similar-1.json` is (`totalResultsSize: 232`, `nextItemToken: 50`, 50 WOs).

**The three unknowns — 2 of 3 found:**

| Board feature | JSON | Status |
|---|---|---|
| STARTING_SOON tag | `$.workOpportunities[].tags[]` contains literal `"STARTING_SOON"` | ✅ **exact match** (also found `TRAILER_READY`) |
| Trailer "P" marker | `$.workOpportunities[].loads[].stops[].trailerDetails[].assetOwner` ∈ `AZNG`(50) / `NCSL`(26) / `HUBG`(1) / null | 🟡 **candidate**, per-STOP not per-card; `AZNG → "P"` unproven |
| Price-increase highlight | zero occurrences of `INCREASE` in either file | ❌ **ABSENT** |

`matchDeviationDetails.deviatedFieldList` (values `[]`, `["PAYOUT"]`, `["PRICE_PER_MILE"]`,
`["PAYOUT","PRICE_PER_MILE"]`, **similar-endpoint only** — null in all of search-2) is a *different*
thing: it corresponds to the `wo-total_payout__match-deviation-attr` class from the 2026-07-31
payout fix, **not** the `__modified-load-increase-attr` price-increase class. Useful independent
confirmation of that class's meaning.

**Claim verification:** (a) ✅ identical 7 top-level keys in all three files. (b) 🟡 the cited id
`9d3ff2b0-…` **does** exist in `similar-1.json` with `LIMA_DIS…` → `LUK2` confirmed, and all 54
ids are unique UUIDs — but the DOM↔JSON join itself cannot be verified without a paired DOM
capture. (c) ✅ formula correct, ❌ **numbers wrong**: that record's `payout.value` is
`321.0882605817431`, not 303.39 — `/73.04715378267576` = **4.3956** ($4.40/mi), not 4.15.
(d) ✅ confirmed — `equipmentType`/`specialServices` absent from the WO, present on `loads[]`.
(e) 🟡 **partly** — a double-encoded string in search-1/search-2, but **`null` in similar-1**.

**Multi-load:** across 54 WOs / 88 loads, **0 have mixed `equipmentType`**; 29 have mixed
`loadType` (EMPTY/LOADED repositioning legs). `loads[].payout` sums exactly to WO `payout` and
`loads[].distance` exactly to `totalDistance`. So the board's single equipment label is
unambiguous in this data.

**Pagination:** `similar-1` returns 50 of 232 with `nextItemToken: 50` (== array length ⇒ offset
cursor). **One response is one page, not the board.** The JSON also contains far more than the
board renders, so an accumulated store would alert on loads the dispatcher cannot see.

**Cost:** ~7,665 B/load raw JSON vs ~241 B/load for today's flat Phase-1 strings — **~32×**. A
full 232-result similar query ≈ **1.8 MB per tab**, on a board that already ships a memory
watchdog.

**Also absent:** per-segment duration (only WO-level `totalDuration` ms and `layoverDuration`).
Stop times exist only as `actions[].plannedTime` in UTC, needing per-stop `location.timeZone`
formatting — the DOM supplies these pre-formatted.

### 2026-07-31 — Payout now parses in the "Similar matches" section

**Diagnosis confirmed** (`content/loadParser.js:16`, was
`card.querySelector('.wo-total_payout')`). The reason it missed: a CSS class selector matches
whole class **tokens**. `wo-total_payout__match-deviation-attr` is one indivisible token — not
`wo-total_payout` plus a suffix — so `.wo-total_payout` never matched it, and **every** load in
the Similar-matches section parsed with `payout = null`.

**Fix:** one selector, both classes —
`.wo-total_payout, .wo-total_payout__match-deviation-attr`. No `css-*` hash anywhere (asserted by
the harness). Listed explicitly rather than a `[class^="wo-total_payout"]` prefix match, because
a prefix/substring match would also hit an ancestor or sibling whose class merely starts the same
way, and `querySelector` returns the first match in **document order**, not selector order — an
earlier wrapper would silently win and yield the wrong text.

**Guard untouched.** The trailing `|| null` is unchanged: an unreadable payout still yields
`null`, so the PAT modal keeps the field empty, shows its warning and blocks Confirm.
`patModal.js` was not modified. Verified as case (c).

**⚠️ Finding — a THIRD member of this family already exists and is still unmatched.**
`AMAZON_SELECTORS.md` has documented `.wo-total_payout__modified-load-increase-attr`
(price-increase highlight) since the original selector capture. The naming pattern is clearly
`wo-total_payout__<variant>-attr`, which strongly suggests price-increased loads hit the *same*
bug today — payout silently null. **Deliberately not added**: no capture proves that class is on
the payout element rather than a separate badge, and if it is a badge preceding the payout in
document order, matching it would make those loads report the **wrong number** — worse than null.
Capture one price-increased card's inner HTML and it becomes a one-token change.

**Other fields in that section:** the capture shows price/mile on the ordinary
`wo-card-header__components`, so it and the other component-based fields (cities, times,
distance, duration) parse normally — confirmed in the harness. **Not verifiable without a fuller
capture:** the non-`wo-*` selectors the same parser depends on — `.equipment-type-text`,
`.trailer-type-circle`, `.loading-type`, `span[title="Deadhead"]`, `#STARTING_SOON`/`.wo-tag`,
and `div[id]` (load ID). If any of those differ inside this section they fail the same silent
way. One capture of a complete Similar-matches card would settle it.

**Verified** (no browser): 25 checks driving the **real** `parseOneCard()` against both captured
markup shapes. The harness implements CSS whole-token class matching and **asserts its own
matcher first** — including that `.wo-total_payout` does *not* match the variant token, i.e. it
reproduces the bug before proving the fix. Also asserts a selector-level diff against HEAD:
exactly one selector added, one removed, and no `css-*` hash introduced.

### 2026-07-31 — Load row background → #F5F5F5 (light mode only)

**Element:** `.ext-seg-body` — the per-leg body in the inline accordion panel: the surface behind
each load's stop rows, and the bottom half of the header+body card pair whose header is
`var(--ext-leg-header-bg)` (#CFDBFB).
**Rule:** `content/inlinePanel.js` `injectPanelStyle()`, `.ext-seg-body{…background:#F5F5F5…}`
(was `#FFFFFF`). Existing stylesheet mechanism, no new stylesheet, no `!important`.

**Light-mode only, structurally:** `content/nightMode.js` already overrides this exact selector's
`background-color` with `DK_HIGH !important`, so the hex is never exercised in dark mode.
`nightMode.js` untouched.

**⚠️ Consequence worth checking visually — the zebra striping effectively disappears.** Even table
rows are tinted `var(--ext-n100)` = **#f5f7fa**, which against the new **#F5F5F5** body is a
2-point difference on one channel. It was previously #f5f7fa on #FFFFFF, a visible stripe. If you
want the striping back, the zebra tint needs to move (one line,
`.ext-inline-panel__table tbody tr:nth-child(even) td`); not changed here because it was not asked
for.

**Interpretation flagged:** "load rows" was read as the per-leg body (`.ext-seg-body`), matching
how the previous task's "load headers" mapped to `.ext-seg-header`. The alternative reading is the
table cells (`.ext-inline-panel__table td`). Both are one-line changes — say the word if you meant
the cells.

**Verified** (no browser): 12 checks running the actual `injectPanelStyle()`/`buildNightCss()` —
the rule carries #F5F5F5 with no `!important`, exactly one such declaration, #F5F5F5 appears
nowhere in the night stylesheet, the night `!important` override is still present and still wins,
`nightMode.js` has no related diff, no new `<style>` element was introduced, and a hex-diff
against HEAD confirms **#F5F5F5 is the only newly-introduced colour** in the whole panel CSS.

---

### 2026-07-31 — STILL BLOCKED: collapse Amazon's filter panel on start (2nd request)

Re-requested with new markup showing `aria-label="Filter  "` (trailing spaces). **Still nothing
implemented — the blocker is unchanged and is not the selector.**

**What the new capture changes:** it invalidates the selector this file recommended on the
previous attempt. `[aria-label="Filter"]` is an exact match and does **not** match `"Filter  "`,
so that recommendation would have failed exactly like the three 2026-06-18 attempts. BACKLOG.md
now carries a corrected trim-based lookup. Finding the button is solved.

**What is still missing:** how to read whether the panel is currently open. The control is a
toggle, so acting without that read would OPEN it when already collapsed — the stated failure
mode. The capture is truncated (`…`) precisely where the button's own attributes would be, and
the 2026-06-18 investigation recorded that Amazon *"may not put `aria-expanded` on the button at
all"*. The paste-in DevTools snippet that would settle it — run once with the panel open, once
collapsed — is in BACKLOG.md and is unchanged.

### 2026-07-31 — FIX: clicking a load card stops auto-refresh again (regression)

**Symptom.** With auto-refresh running, clicking a load card no longer stopped the loop; it kept
refreshing until the dispatcher stopped it by hand.

**Cause — scenario (i): the loop was never told to stop.** `tabState.set('running', false)` lived
*inside* the `waitForSheet` callback (`inlinePanel.js`). That callback is gated by **guard 3**,
added 2026-07-30 with the single-flight fix (which stopped card A's poll rendering card B's
sheet — a real hazard, it could produce a PAT post for the wrong load):

```js
if (card && (_sheetPollCard !== card || !document.contains(card))) { …; return; }
```

While the loop is **running**, `refreshNow()` makes Amazon re-render the load list, which
**detaches the very card the dispatcher just clicked** — inside guard 3's own 50–1500ms poll
window. The run was discarded, the callback never ran, and the stop never executed. The faster
the refresh interval, the more reliably it happened. Nothing restarted the loop and nothing
survived a stop: the stop simply never fired.

**When it last worked.** Before the uncommitted 2026-07-30 single-flight change. The committed
signature is `waitForSheet(callback, prevFingerprint)` with no `card` parameter and no guard 3 —
so `git log` shows no commit that broke it; the regression is in the working tree.

**Fix — the existing stop moved to the correct layer, no second call added.** The stop now runs
synchronously in the click handler, before `waitForSheet`. Stopping belongs to the *click*, not
the *render*: the dispatcher clicked a load to review it, and that intent does not depend on
whether Amazon's sheet finished opening, whether the poll timed out, or whether React replaced
the card node. Guard 3 still governs the render, which is the only thing it was meant to protect.
`inlinePanel.js` still contains **exactly one** `tabState.set('running', …)` call. Side benefit:
a sheet that never opens (poll timeout) now also stops the loop, which it previously did not.

**⚠️ Your evidence could not have come from a stock build.** The quoted line
`[inlinePanel] manual card open — stopping loop for dispatcher review` is a `logger.log`, which
requires `DEBUG_LEVEL >= 3`; `utils/constants.js` ships `DEBUG_LEVEL = 1`. So it cannot print
unless the level was raised locally. Worth knowing because at level 3+ the discard path also
logs `waitForSheet: card no longer the one being waited on — discarding result` — that line
appearing *instead of* the stop line is the fingerprint of this bug.

**Verified** (no browser): 24 checks driving the real `tabState.js`, `content.js` and
`inlinePanel.js` in a vm, counting real `refreshNow()` calls. Includes a **mechanism proof** —
with the card detached mid-poll the loop kept refreshing before the fix and stops after it, with
an attached-card control alongside to show the detachment is what matters. Three earlier harness
failures were my own stub bugs, not code faults (poll waits shorter than `REFRESH_SETTLE_MS`; a
sheet fingerprint that never changed so `waitForSheet` waited out its full 1500ms timeout; and
`DEBUG_LEVEL` undefined because `constants.js` was not loaded).

### 2026-07-31 — Accordion leg-header colour → #CFDBFB (light mode only)

One value, one file: `utils/designTokens.js`'s `--ext-leg-header-bg`, `#DCE6E9` → `#CFDBFB`.

**Element and rule:** `.ext-seg-header` — the accordion leg headers in the inline panel —
via `background:var(--ext-leg-header-bg)` at `content/inlinePanel.js:96`. The existing token
mechanism, as instructed: no new stylesheet, no `!important`, and `inlinePanel.js` itself was
not edited (the colour lives in the token, and the consuming rule already pointed at it).

**Light-mode only, structurally.** The token is declared in the `:root` block with deliberately
no `html.ext-night` counterpart, because `content/nightMode.js:130-131` already overrides
`.ext-seg-header`'s `background-color` with `DK_HIGH !important`. That `!important` is what
guarantees the token's value can never be exercised in dark mode — so changing it cannot leak.
`nightMode.js` was not touched.

**⚠️ Contrast — one real regression, reported not fixed.** Computed to WCAG 2.1, reading the
colours out of the real source files:

| Text on the header | Old (#DCE6E9) | New (#CFDBFB) | AA 4.5:1 |
|---|---|---|---|
| `.ext-seg-header` base + `.ext-route-origin`/`.ext-route-dest` — `#1F3A45` | 9.45:1 | **8.68:1** | passes (AAA) |
| `.ext-route-arrow`, `.ext-seg-dist`, `.ext-seg-header .ext-seg-arrow` — `#4A6570` | 4.88:1 | **4.48:1** | **fails by 0.02** |

The secondary colour `#4A6570` drops just below the 4.5:1 AA threshold. These are 11–12px, which
is **not** "large text" under WCAG at any weight (large = ≥18.66px bold or ≥24px), so 4.5:1 is
the applicable bar, not 3:1. It passed before this change and does not now.

**Not fixed, because the task scoped this to the background colour and `#4A6570` was itself
spec'd in the 2026-07-30 redesign.** The minimal fix if you want it: `#4A6570` → **`#49646F`**
(1% darker, same hue) = 4.55:1. Three declarations would change — `inlinePanel.js:173`, `:178`,
`:200`. Your call.

The pills (`.ext-seg-loaded`, `.ext-seg-empty`, and the `#E1EFFE` pill) carry their own
backgrounds, so their internal text contrast is unaffected (7.70–9.37:1, unchanged). Their
separation *from* the header actually improves slightly (1.09–1.15:1 → 1.18–1.26:1).

**Verified** (no browser — see below): 21 checks on a harness running the actual
`injectPanelStyle()` / `buildNightCss()` and the real token source — token value and uniqueness,
that it sits in `:root` and not in `html.ext-night`, that `.ext-seg-header` still consumes the
var with no hardcoded hex and no new `!important`, that neither `#CFDBFB` nor `#DCE6E9` appears
anywhere in the night stylesheet, that the night `!important` override is still present and
still wins, and that exactly one token declaration differs from HEAD with the token count
unchanged.

---

### 2026-07-31 — BLOCKED, nothing implemented: collapse Amazon's filter panel on auto-refresh start

**Stopped deliberately, per the task's own instruction** ("if you cannot determine it reliably,
STOP and tell me what to capture in DevTools instead of guessing"). No code was written.

**Why: this exact feature was built and removed once already.** See CHANGELOG 2026-06-18
"Remove filter-panel auto-close" — three strategies (close-button search, toggle-button click,
Escape dispatch + retry) were tried and none worked reliably. `panelCloser.js:72` still carries
the resulting comment: *"Left filter panel is intentionally left alone."* `CLOSE_FILTER_PANEL`
was removed from `ALLOWED_CLICK_INTENTS` at the same time, so re-adding this needs a SAFETY.md
click-site authorisation too.

**New information that explains the old failure.** Every prior attempt selected
`button[aria-label="Filter"...]` — i.e. it expected `aria-label` on the **button**. The freshly
captured markup shows it is on an inner **`<span role="img">`**:

```html
<button type="button" class="css-14evw8c">…<span aria-label="Filter" role="img">…
```

So `document.querySelector('button[aria-label="Filter"]')` matches **nothing**, which is
consistent with all three attempts failing. Finding the button is therefore solvable now:
`document.querySelector('[aria-label="Filter"][role="img"]')?.closest('button')` — no dependence
on the generated `css-14evw8c` hash.

**What is still NOT solvable from available evidence: the panel's open/collapsed state.** The
capture is truncated exactly where the button's own attributes would be, and the 2026-06-18
investigation explicitly recorded that Amazon *"may not put `aria-expanded` on the button at
all"*. A diagnostic (`diagFilterPanel()`) was written back then to answer this and its output was
never recorded before the code was deleted. Since the control is a toggle, acting without a
reliable state read would **open** the panel whenever it was already collapsed — the opposite of
the requirement. Hence the stop. See STATE.md / BACKLOG.md for the exact DevTools capture needed
to unblock this.

### 2026-07-31 — Only a genuine 429/503 may pause the extension (was: any non-2xx, and aborts)

Fixes the finding reported at the end of the previous task. Two files:
`content/networkObserver.js` (stop reporting aborts) and `background.js` (read the status).
`content/content.js` was **not** changed — it still relays every observed result verbatim, and
the filtering now lives in `background.js` where the decision is made.

**What was wrong.** `reportResult(ok, status)` accepted `status` and never read it; the whole
decision was `if (ok)`, so the `else` branch fired for *any* non-2xx. Meanwhile an aborted
request was reported as a failure by both observer paths. Switching a saved search aborts the
in-flight `/api/loadboard/search`, so ordinary use pushed the extension into backoff and
escalated it through 5/10/20/40/80s — sticky until a 2xx it was no longer requesting. The
dispatcher's board kept working, so nothing looked wrong, while our monitoring was off.

**Fix 1 — aborts are never reported (`content/networkObserver.js`).**

*fetch:* the `.catch` now returns early on an abort. Two independent signals, either sufficient:
`signal.aborted` on the request's own AbortSignal (captured before the call, from either
`init.signal` or `Request.signal`), and `err.name === 'AbortError'`. Both are needed, not one:
`AbortController.abort(reason)` rejects with the caller's `reason`, which need not be a
DOMException and need not be named `AbortError` — `signal.aborted` catches that case; and
`err.name` catches an abort whose signal we could not see. A genuine failure rejects with a
`TypeError` and an un-aborted signal, so it still reports as status 0.

*XHR:* was one `loadend` listener. `loadend` fires for **every** terminal outcome — load, error,
timeout **and abort** — and an abort arrives with `status === 0`, indistinguishable there from a
real network failure. Replaced with three specific listeners (`load`, `error`, `timeout`);
`abort` is simply not subscribed, which makes the distinction structural rather than inferred.
Same reporting surface as before, minus aborts.

**Fix 2 — the status is now read (`background.js`).** New
`const RATE_LIMIT_STATUSES = [429, 502, 503, 504]`. The escalation branch runs only for those;
every other failure returns **without** `setState`, so no storage write fires and an in-flight
backoff is neither extended nor cleared.

**502 and 504 included by PM decision (same day), as a deliberate safety-side default made
without captured data.** We have never observed Amazon throttling via a gateway status. They are
in because the cost is asymmetric: if a gateway status *is* a throttle and we do not back off, we
keep hammering Amazon and risk an IP block on the dispatcher's account — the exact outcome this
backoff exists to prevent. If it is an ordinary gateway error, we lose a few seconds and recover
on our own. Recorded in the comment at the constant so it can be revisited if evidence appears.
**500 stays out** — an application error is not a throttle, and retrying more slowly does not
help it.

**The backoff itself is untouched** — timings, escalation, cap, jitter, the sticky flag, 2xx
reset, and permit suppression are all byte-for-byte the same code. Verified by A/B against the
committed file (PART 4 below).

**Requirement 5 — the false comment is gone.** `background.js:208-212` claimed *"Never called on
3xx/4xx — content.js only reports results for responses it identifies as either success or a
5xx/network failure"*. That was never true. The replacement states what the code does and notes
explicitly that content.js relays everything unfiltered.

**⚠️ Deliberate narrowing you should be aware of:** the old *documented* intent was "any 5xx".
`500` now does **not** pause. (502/504 were briefly excluded too, then added back the same day —
see above.) That is a small reduction in coverage versus the stated intent, not just versus the
bug.

---

### 2026-07-31 — REPORT ONLY: what the other statuses should do (requirements 3 and 4)

Requested as a separate decision. **None of this is implemented** — every status below currently
does nothing beyond a console log.

| Status | What it means here | Recommendation | Confidence |
|---|---|---|---|
| **502, 504** | Gateway/timeout from whatever fronts Amazon's API. Plausibly the *same* IP throttle surfacing through a CDN rather than the origin. | ~~Probably add — but capture evidence first.~~ **DECIDED same day: added to `RATE_LIMIT_STATUSES`.** Safety-side default without data — the asymmetric cost (risking a real IP block vs losing a few seconds) settles it. Revisit if evidence appears. | Low — no data, decision made on cost asymmetry not evidence |
| **500** | Application error on Amazon's side. Not a throttle, not about us, and retrying at a slower rate does not help. | Leave out. Log only. | Medium |
| **401, 403** | Session/auth problem, not a rate problem. Backoff is the wrong lever entirely — it would leave the loop suppressed while the actual fix is re-authentication. | No backoff. The useful response would be a gate re-check (`recheckAuthGate()`), which is a behaviour change needing its own task. | High |
| **404** | Either a bad query from the page, or — more worrying — `WATCH_PATH` has gone stale and Amazon moved the endpoint. If sustained, the extension is silently blind, not rate-limited. | No backoff. Worth a **loud** log, because sustained 404s on this path mean our core assumption broke. | High |
| **400** | Malformed request built by Amazon's own page. Nothing to do with us. | Ignore. | High |
| **0 (genuine network failure)** — requirement 4 | Browser offline, DNS failure, connection refused. No server said anything, so there is nothing to back off *from*. | **No backoff — current behaviour is correct.** While offline the loop keeps ticking and failing every interval; Chrome fails offline fetches fast, so the cost is negligible and it means we resume the instant connectivity returns. | High |

**One structural note while looking at this:** the sticky `rateLimited` flag cannot deadlock.
Permits are suppressed only while `backoffUntil > now`; once that expires, permits flow again
even though `rateLimited` is still true, so a 2xx can be observed and clear it. The flag is
display-only, exactly as its comment claims.

**Verification.** No browser; the 6-point smoke checklist is **NOT RUN**. `node --check` passes
on both files. A Node `vm` harness, **89 checks, all pass**, in four parts:

1. **The real `networkObserver.js`** driven with the **real `AbortController`/`DOMException`**
   and an XHR double that fires the same events a browser does (including `loadend` after every
   terminal outcome, so the old code path would have been caught).
2. **The real `background.js`** driven through its **real `chrome.runtime.onMessage` listener**,
   exactly as content.js relays.
3. **End to end** — observer output piped straight into background with no hand-written messages
   in between, including 10 rapid saved-search switches.
4. **A/B against `git show HEAD:background.js`** — identical step-index sequences over 8
   consecutive failures for both 429 and 503, identical reset-on-2xx state, and durations still
   landing in 5s/10s/20s/40s/80s/5min ±20%.

Stubs mean this proves message-level behaviour, not real Chrome/Amazon behaviour — the browser
half is TC-RATELIMIT-7.

### 2026-07-31 — Sidebar paused/rate-limit message removed (message only)

Removed by PM decision. The amber row-1 line — *"Paused — Amazon has temporarily limited your IP
due to frequent refreshes. Access returns on its own; the extension will resume automatically."*
— along with its trailing "i" icon and that icon's 340px tooltip, which existed only to
accompany it.

**The pause behaviour is untouched.** `background.js` and `content/networkObserver.js` were not
edited at all (they do not appear in `git status`); `content/content.js`'s relay was not touched
by this task. The extension still stops polling on 429/503, still backs off, still resumes on the
next success. All edits were in `content/sidebar.js`.

**Removed:** 4 elements (`ext-rate-limit-banner`, `ext-rate-limit-text`, `ext-rate-limit-info`,
`ext-rate-limit-tooltip`), 1 `row1.appendChild`, 4 CSS rules, 5 shared CSS selectors narrowed to
their memory-icon half, 2 tooltip helper functions, 5 event listeners, and the paused branch of
`updateRateLimitDisplay()`. **Nothing was left commented out in the source** — the full
reinstatement record, with verbatim original code, is in BACKLOG.md "Sidebar paused/rate-limit
message (reinstatement record)".

**Two judgment calls, both flagged for reversal if you disagree:**

1. **The slider swap went with the banner.** `updateRateLimitDisplay()` used to hide
   `slider`/`sliderValue` while paused so the banner could take their place. That hiding existed
   *only* to make room for the banner; keeping it would have made the speed control silently
   vanish during a pause with nothing left on screen to explain why. The slider now stays visible
   in every state. Reinstating the banner requires restoring those three lines too.
2. **`renderSharedRateStatus()` was left exactly as-is.** It still hides row 2 (the "Active
   tabs: N" line) while paused — a condition originally justified by "the banner already explains
   the paused state". That element is not the message, and the task was scoped to the message, so
   it was not touched. Consequence: while paused, row 2 disappears and the bar is 20px shorter
   (body padding tracks it, so no gap or overlap), with no text anywhere explaining why.

**Kept deliberately:** `#ext-sidebar{max-width:calc(100vw - 16px)}`, added for the banner's long
sentence. It is what bounds row 2's width so its `text-overflow:ellipsis` can trigger, and
removing a purely defensive cap is a layout change that could not be tested here.

**Verification.** No browser; the 6-point smoke checklist is **NOT RUN**. `node --check` passes.
A Node `vm` harness (79 checks, all pass) drives the **real** `background.js` through its real
`chrome.runtime.onMessage` listener, and builds the **real** `sidebar.js` against a stub DOM. See
the verification table in the task report. Stubbed DOM ⇒ structure and state only, not pixels.

---

### 2026-07-31 — REPORT ONLY: what actually puts the extension into the paused state

Requested because the dispatcher saw the paused message while merely switching between saved
searches, where no Amazon rate limiting should be involved. **Nothing was fixed.**

**Answer: a single failed or aborted request is enough. A real 429/503 is not required.** The
HTTP status is never examined anywhere in the chain — the only thing that matters is a boolean.

**The chain, with the condition at each step:**

1. **`content/networkObserver.js:38-44`** — for any request whose URL contains
   `/api/loadboard/search`:
   ```js
   result.then(function (resp) { report(url, resp.ok, resp.status); })
         .catch(function () { report(url, false, 0); }); // network failure — no HTTP status at all
   ```
   A rejected fetch reports `ok:false, status:0`. **An aborted request rejects**, so an abort is
   indistinguishable here from a real network failure.
2. **`content/networkObserver.js:56-63`** — the XHR path has the same hole via a different
   route: it listens on `loadend`, which fires on abort and error as well as success, and
   computes `ok` as `xhr.status >= 200 && xhr.status < 300`. On an abort `xhr.status` is `0`, so
   `ok` is `false`.
3. **`content/content.js:88-100`** — relays **every** observed result to background.js verbatim,
   with no filtering:
   ```js
   chrome.runtime.sendMessage({ type: 'REPORT_RESULT', ok: data.ok, status: data.status })
   ```
   Note: `background.js:208-212` claims *"Never called on 3xx/4xx — content.js only reports
   results for responses it identifies as either success or a 5xx/network failure"*. **That
   comment is wrong.** No such filtering exists in content.js.
4. **`background.js:220-236`** — `reportResult(ok, status)`. `status` is accepted as a parameter
   and **never read**. The entire decision is `if (ok) { …clear… } else { …pause… }`, so the
   `else` branch sets `state.rateLimited = true` and starts backoff for *any* falsy `ok`.

**Confirmed by execution**, driving the real `background.js` through its real message listener:

| Reported | Result |
|---|---|
| `ok:false, status:0` (aborted / failed request) | **PAUSES** |
| `ok:false, status:404` | **PAUSES** |
| `ok:false, status:401` (an auth problem, not a rate problem) | **PAUSES** |
| `ok:false, status:429` / `503` | PAUSES (correct) |
| `ok:true, status:200` | does not pause |

**Why switching saved searches would trigger it:** the load board is an SPA. Changing the search
replaces the in-flight `/api/loadboard/search` request — either cancelled via `AbortController`
(fetch rejects → step 1) or `xhr.abort()` (→ step 2). One such abort sets `rateLimited = true`
and starts a 5s backoff; the state is **sticky** and only clears on an observed 2xx.

**Severity beyond the message.** Removing the message hides this from the dispatcher but does not
stop it: a spurious pause still suppresses permits (`background.js:97`), so the extension really
does stop polling for the backoff duration after an ordinary search switch. Escalation is real —
repeated switches walk `BACKOFF_STEPS_MS` `[5s, 10s, 20s, 40s, 80s]` toward the 5-minute cap.

**Fix shapes, not implemented — your call:** (a) filter in `content.js` so only 429/503/5xx are
relayed; (b) inspect `status` in `reportResult()` and only pause on rate-limit statuses;
(c) distinguish abort from failure in `networkObserver.js` (fetch: check `err.name === 'AbortError'`;
XHR: use the `abort` event rather than `loadend`) and don't report aborts at all. (c) is the most
precise and (a)/(b) the cheapest; they are not mutually exclusive. Whichever is chosen, the
`background.js:208-212` comment needs correcting either way.

### 2026-07-30 — Popup renders from local state; a lost connection no longer signs anyone out

One change, two symptoms. The popup used to await a network round trip before deciding what to
render — that was both the 1–1.5s "Checking your session…" screen **and** the reason a failed
call dropped the dispatcher onto the login form. PART B (below) had already established that the
call never discovered anything: the stored session at `popup.js:237` carries `expires_at` and
`user.email`, the comparison at `popup.js:244` is a complete signed-in decision, and the
`storage.onChanged` handler has always rendered the logged-in state from exactly that local data
with no network at all.

**Now:** read storage → decide → render. If a stored session exists and `expires_at - now > 30`
(same margin, same comparison), the full panel goes up immediately. Otherwise the login form
does. Nothing in that path touches the network. Validation runs afterwards, against a UI that is
already on screen. The `popup-auth-checking` block and its CSS are gone from `popup.html` /
`popup.css`, and the 3000ms bounded-wait timer is gone from `popup.js` — both existed only to
manage a wait that no longer happens.

**"The server said no" vs "I couldn't reach the server" — the distinction is reliable.** Verified
by reading the shipped `vendor/supabase.min.js`, not from docs or memory:

| Situation | What gotrue produces |
|---|---|
| fetch rejects — offline, DNS, refused, abort | `AuthRetryableFetchError`, status **0** (minified `Vr`: `catch(e){…throw new Zn(J(e),0)}`) |
| HTTP 500,501,502,503,504,520–530 | `AuthRetryableFetchError`, that status (minified `zr`: `if(Rr.includes(e.status))`) |
| a real auth verdict — 401/403/400, revoked token | `AuthApiError` carrying that status |

gotrue **returns** these as `result.error` rather than throwing (its catch does
`if(isAuthError(e)) return {…,error:e}`), and `_getUser` passes the instance through untouched,
so both paths arrive intact. `isServerVerdict()` uses the library's own exported
`isAuthRetryableFetchError` predicate (the UMD bundle exports it alongside `createClient`), with
a `name` check as fallback. Anything that is not a supabase auth error at all — a `TypeError` out
of the client, the synthesized `'setSession failed'` — is also treated as "no answer": **signing
someone out now requires a positive server-issued verdict, nothing weaker.** That last part is a
deliberate widening of the old behaviour, which cleared the session on any throw.

- **Unreachable** → nothing changes. Session kept, view kept, dispatcher stays signed in, and
  `MSG_NO_CONNECTION` ("No connection — check your internet.") goes into the existing
  `popup-auth-status` line — inline, non-blocking, no new UI element. Logged via `logger.error`
  with `errorName` + `status`.
- **Verdict** → unchanged from before: clear the session, fall back through
  `restorePendingOrEmailStep()` so a pending OTP still resumes at the code step.

**Accepted trade-off (PM decision):** a session revoked server-side shows the panel for a few
hundred ms before validation corrects it. Access is free at this stage, so there is nothing to
gate.

**Scope.** Every Supabase call, storage key, branch condition, and the 30s margin are unchanged —
only *when* each result is applied and what a failure is permitted to do. The `.catch` on
`restoreSession()` stays (a failed local storage read still needs the login form, and without it
this is an unhandled rejection).

**Note on first paint:** `chrome.storage.local.get` is async, so the popup paints its header and
"Account" title before the decided block appears. That gap is a local IPC round trip, not a
network one, and no *wrong* state is ever rendered in it — every auth and feature block starts
`hidden`. A synchronous decision would mean moving the session out of `chrome.storage`, which is
a storage change and out of scope.

**Behavioural finding, unchanged by this fix but now user-visible in a new place.** On the
*locally expired* + offline path, `refreshSession()` does not fail fast: gotrue's
`_refreshAccessToken` retries with exponential backoff (`200 * 2^(attempt-1)`) while the error is
retryable, bounded by `N = 30*1e3` — read out of the bundle, and **measured at ~25.6s** in the
harness before the failure surfaced. Consequences: the login form still appears instantly (it no
longer waits on anything), the stored session is still **not** cleared, but the "No connection"
note on that one path can take ~25–30s to appear. The common case — valid session + offline —
is prompt, because `setSession`/`_getUser` has no retry wrapper. Left as-is: it is library
behaviour, and changing it means passing a custom fetch or timeout into a Supabase call, which
this task's scope excludes.

**Verification.** No browser in the execution environment; the 6-point smoke checklist was **NOT
RUN**. `node --check` passes. A Node `vm` harness loads the real `utils/*.js`, the **real
`vendor/supabase.min.js`**, and the real `popup.js`, seeding element visibility from the real
`popup.html`. Supabase is **not** stubbed — popup.js calls the real `createClient` /
`setSession` / `refreshSession`, and only `fetch` is swapped, so the error classification is
produced by the shipped library itself rather than by hand-built error objects: offline = a
rejecting fetch, 401/503 = real `Response` objects. 51 checks, all pass, including the panel
being visible *while the network call is still in flight*, a 503 not signing anyone out, and the
signed-out path making **no** network call at all. Stubbed DOM ⇒ sequencing and state only, not
layout.

---

### 2026-07-30 — REPORT ONLY: can `supabase.min.js` be loaded after first paint?

Requested alongside the change above; **nothing was implemented.**

**Short answer: yes, but not by moving the `<script>` tag — that alone breaks login entirely.**
First paint no longer needs the client, but three things still assume it exists synchronously.

**What actually blocks it.** `popup.js:41-44` creates the client at top level, guarded by
`typeof supabase !== 'undefined'`. Deferring the bundle makes that guard fail, leaving
`supabaseClient === null` — and `restoreSession()` (`popup.js:257`) treats a null client as
"login not configured" and routes straight to `restorePendingOrEmailStep()`. **Every dispatcher,
signed in or not, would land on the login form.** Note `<script defer>` on the bundle alone is
exactly this trap: deferred scripts run *after* non-deferred ones, so `popup.js` would execute
first.

**What would need to change** (all in `popup.js`, none of it in the first-paint path):
1. Create the client lazily — a `getSupabaseClient()` that constructs on first use once the
   bundle has loaded, instead of the top-level `if` at line 41.
2. `restoreSession()` must stop treating "no client yet" as "not configured". It already reads
   storage and renders before any Supabase call, so the split is natural: render, then await the
   client, then validate.
3. The five `if (!supabaseClient)` guards at lines 257, 325, 356, 389, 425 currently show
   **"Login not configured."** — a dispatcher who clicks "Send code" during the load window
   would get a misleading error. They need to await the client instead of failing.

**What would NOT break:** the new `isServerVerdict()` already guards with
`typeof supabase !== 'undefined'` and falls back to a `name` check, so it survives a late load.
`utils/supabaseConfig.js` only defines two constants. Nothing else in `popup.js` touches the
`supabase` global.

**Separate surface, same pattern:** `utils/authGate.js:15` does the identical top-level
`typeof supabase` check, ordered by `manifest.json`'s `content_scripts`. The same optimisation is
available there and has the same failure mode — a gate that closes because the bundle had not
loaded yet means features silently never activate on that page load. Out of scope here; flagged
because a fix in one place invites the same change in the other.

**Honest caveat on the payoff.** The claim that bundle parsing dominates the remaining delay is
**inferred, not measured** — I have no browser. What is measured: the file is 207,722 bytes of
the ~247KB total, and it is a blocking `<script>`. Before spending the refactor above, measure
it: Chrome devtools Performance panel on the popup, look at "Evaluate Script" for
`supabase.min.js`. If it is 30ms, this is not worth the three changes and their failure modes.

---

### 2026-07-30 — Popup no longer flashes the login screen at a signed-in dispatcher

**The bug.** Opening the popup while signed in showed the "Free access — sign in with your
email" block for ~1–1.5s before the real panel replaced it. Nothing was wrong with the auth
logic: the login block is simply what `popup.html` rendered by default, and the session check
that would replace it is async. Whichever of the two blocks you render on spec is wrong for one
of the two kinds of user, for the whole duration of the check.

**The fix — a third, neutral state.** `popup.html` now ships `hidden` on
`popup-auth-gate-note` and `popup-auth-step-email` (the code step, logged-in row, and
`popup-features` were already `hidden`), so **no** auth or feature markup is visible at first
paint. In their place is a new `popup-auth-checking` block reading "Checking your session…".

**One switch, by construction.** Leaving the neutral state happens inside `showAuthStep()`
(`popup.js:172`) and nowhere else. Every path that can produce an answer already funnels through
that one function — `showLoggedIn()`, both branches of `restorePendingOrEmailStep()`, the new
timeout fallback, the `chrome.storage.onChanged` cross-page sync, and every button handler — so
the neutral block is hidden exactly once, on the first real answer, without six call sites
having to remember to do it.

**Sizing.** `.popup-auth-checking` gets `min-height: 92px`, computed from the two elements it
stands in for at the popup's fixed 320px width: gate note (14px × 1.4 line-height, wrapping to
2 lines = 39.2px, + 14px margin) + email step (~29px input + 10px margin). The arithmetic is in
the CSS comment. **Derived from the CSS rules, not measured in a browser** — if the gate note
wraps to a different line count with the real font, that is the number to correct. This makes
the signed-**out** transition jump-free. The signed-**in** transition still grows the popup,
because `popup-features` is several hundred px tall — unavoidable for any neutral state, and
identical to what already happens the moment you finish logging in.

**No spinner**, deliberately: `popup.css` has no `@keyframes` and no `animation` anywhere
(grepped), so a spinner here would be a new UI idiom rather than a reused one — the task said
reuse or omit.

**Failure handling — `AUTH_CHECK_TIMEOUT_MS = 3000`.** Chosen from measurement, not taste; the
reasoning is in the comment at `popup.js:141`. The slow step is
`supabaseClient.auth.setSession()`, which on the not-expired branch calls `_getUser()` — a real
`GET {SUPABASE_URL}/auth/v1/user` (confirmed by reading `vendor/supabase.min.js`, not from
memory). Measured to that endpoint from the authoring machine: **171–499ms cold** (DNS + TCP +
TLS + request, 5 runs, median 226ms), **91–176ms warm**. 3000ms is ~6× the slowest cold round
trip. The asymmetry matters: a timeout that fires on a check that was merely slow-but-working
would show the login block to a signed-in user — this exact bug, 3s later. Too long only costs
a longer neutral state. Two fallbacks, both logging `logger.error` (level 1, survives the quiet
default):

- `restoreSession().catch(...)` — it *can* reject: its `chrome.storage.local.get`
  (`popup.js:237`) sits outside any handler. Previously survivable (a rejection left the
  markup's default login block up, which happened to suit a logged-out user); with a neutral
  default it would strand the dispatcher, so it is now handled. It was also an unhandled promise
  rejection before, and no longer is.
- A 3s `setTimeout` backstop for a check that never answers at all, cleared in `.finally()` so a
  late fallback can't overwrite an answer that arrived at, say, 2990ms.

Both fall back through `restorePendingOrEmailStep()`, **not** straight to `showAuthStep('email')`
— a dispatcher who closed the popup mid-code-entry still returns to the code step even when the
session check failed or timed out.

**`restoreSession()` itself is unchanged** — no auth logic, no storage key, no Supabase call was
touched. Only *when* each block becomes visible, plus error handling on the invocation.

**Known edge case, deliberate:** if the timeout fires and the real answer arrives later saying
signed-in, `showLoggedIn()` still runs and the popup switches a second time. The alternative —
suppressing a late correct answer — would leave a signed-in dispatcher looking at a login form.

**Verification.** No browser in the execution environment; the 6-point smoke checklist was **NOT
RUN**. `node --check` passes. Sequencing was proved with a Node `vm` harness that loads the real
`utils/constants.js`, `utils/storage.js`, `utils/logger.js` and `popup/popup.js` against a stub
DOM, **seeding each element's starting `hidden` state by parsing the real `popup.html`** — and
records every `.hidden` assignment, so "never visible at any point" is asserted across the whole
run, not just at the end. 44 checks, all pass: signed-in (login block never visible), signed-out
(features never visible), pending-OTP resume, `setSession` throwing, `chrome.storage` rejecting,
never-answers → 3s timeout, timeout **with** a pending OTP still resuming the code step, and a
slow-but-successful 2.5s check not tripping the timeout. Error capture is at the `console.error`
layer against the real `logger` at the real shipped `DEBUG_LEVEL`, so a level-gating mistake
would have surfaced. The stubs mean **layout is not covered** — the 92px `min-height` and the
absence of a visual jump still need a real browser (TC-AUTH-9 step 6).

---

### 2026-07-30 — PART B (report only, nothing changed): what the popup's 1–1.5s actually is

Requested as read-only analysis alongside the fix above. **Nothing here was optimised.**

**Sequence, popup open → features visible:**

| # | Step | Where | Cost |
|---|---|---|---|
| 1 | Chrome creates the popup document, parses `popup.html` + `popup.css` | `popup/popup.html` | not measured |
| 2 | 6 blocking `<script>` tags fetch/parse/execute in order | `popup.html:226-232` | not measured; **`vendor/supabase.min.js` is 207,722 bytes**, ~84% of the 247KB total |
| 3 | `supabase.createClient(...)` | `popup.js:42` | not measured |
| 4 | `DOMContentLoaded` fires; element lookups; handlers wired | `popup.js:99` | not measured |
| 5 | `restoreSession()` | `popup.js:230` | — |
| 6 | `await chrome.storage.local.get(SUPABASE_SESSION_KEY)` | `popup.js:237` | not measured; local IPC, expected single-digit ms |
| 7 | Local expiry check `expiresAt - nowSec > 30` | `popup.js:244` | free, synchronous |
| 8 | **`await supabaseClient.auth.setSession(...)`** | `popup.js:249` | **the slow step — measured 171–499ms cold, 91–176ms warm** |
| 9 | `showLoggedIn(...)` → `showAuthStep('loggedin')` reveals `popup-features` | `popup.js:254` → `172` | free |

**Which step is slow, and what kind of slow.** Step 8, and it is a **network round trip**, not a
`chrome.storage` read. Confirmed by reading the shipped bundle rather than from memory: minified
`_setSession` decodes the JWT, and on the **not**-expired branch takes
`await this._getUser(e.access_token)`; `_getUser` is
``await Y(this.fetch, `GET`, `${this.url}/user`, {headers, jwt, xform})`` — i.e.
`GET https://beoiwdadatcnobowfsvv.supabase.co/auth/v1/user`. (On the expired branch it is
`_callRefreshToken` instead — also a network call.) **Measured** with `curl` to that exact
endpoint from the authoring machine: 5 cold runs 171/206/226/243/499ms total, warm reuse
91–176ms. Caveat: those returned **401** (no valid bearer token), so they skip the JWT
verification and user-row read a real call performs — the true figure is somewhat higher, but
the same order of magnitude.

So step 8 accounts for roughly 0.2–0.5s+ of the reported 1–1.5s. The remainder is steps 1–4 —
dominated, by inference, by fetching/parsing/executing the 207KB Supabase bundle on every popup
open. **That part is inferred, not measured** (it needs devtools in a real Chrome).

**Is the signed-in answer already available locally before that step?** **Yes.** The session
object read at step 6 already contains everything the UI needs: `expires_at` (step 7 already
makes a purely local signed-in/expired decision from it) and `user.email` (the only field
`showLoggedIn()` displays). Independent proof from elsewhere in the same file: the
`chrome.storage.onChanged` handler at `popup.js:620-623` renders the logged-in state straight
from `changes[SUPABASE_SESSION_KEY].newValue.user.email` with **no** network call at all. The
network round trip at step 8 is a **validation** of a locally-known answer, not a lookup of an
unknown one.

**Is any of it cached between popup opens?** **No.** Each open is a fresh document: the bundle
is parsed again, `createClient` runs again (`popup.js:42`), and the client is configured
`persistSession: false, autoRefreshToken: false` (`popup.js:43`), so it carries nothing in
memory across opens. HTTP-level caching of `/auth/v1/user` is *inferred* not to apply (auth
endpoints are conventionally `no-store`, and the request is `Authorization`-keyed) — I did not
inspect the response headers. Note `utils/authGate.js:37` performs the **same** `setSession`
network validation in every content script on every page load, independently of the popup.

**Measured vs inferred, plainly.** Measured: the `/auth/v1/user` round-trip timings; the fact
that `setSession` calls `_getUser` (read from the shipped bundle); file sizes; that the stored
session carries `user.email` and `expires_at` (read from the code that consumes them). Inferred:
the bundle parse/execute cost, the `chrome.storage` read cost, the popup document creation cost,
and the HTTP-cache claim. **No end-to-end 1–1.5s measurement was taken — that needs a browser.**

---

### 2026-07-30 — Activation lockout fixed (audit B1, High) — `content/content.js` only

**The bug.** `activateExtensionUI()` set `_extActivated = true` on its **second line**, before
`await tabState.init()` and `buildSidebar()`. If either threw, the flag stayed `true` while no
UI had been built — and since the function's first line is `if (_extActivated) return;`, every
later activation call returned early on that flag. The dispatcher was left with a dead
extension: no sidebar, no buttons, no error on screen, and no way back except reloading the
page. Logging out and back in did not help — the fresh login's `activateExtensionUI()` hit the
same early return. The extension could not recover on its own.

**The fix.** `_extActivated = true` now happens **only after all three steps** (`tabState.init`,
`buildSidebar`, `initManualToggle`) have completed without throwing. Three parts:

1. **Failure leaves the flag `false`**, so the next activation attempt runs for real instead of
   being swallowed by the guard. This is the whole point of the fix.
2. **Failure logs `logger.error`** (level 1 — survives the shipped quiet `DEBUG_LEVEL`, unlike
   `logger.log`) with a `step` field naming which of the three steps threw. A `step`-tracking
   local is set before each step rather than wrapping each one in its own try, keeping the
   happy path byte-for-byte the same sequence of calls it was before.
3. **Failure rolls back through the existing teardown**, `deactivateExtensionUI()` — no second
   teardown function to keep in sync. That function early-returns unless `_extActivated` is
   true, so the catch sets it true purely to open that gate; `deactivateExtensionUI()` itself
   sets it back to false on its first line, and a `finally` re-asserts `false` in case the
   teardown threw before reaching it. Nothing can observe the momentary `true`:
   `deactivateExtensionUI()` is fully synchronous, and any activation call arriving during it
   is blocked by the in-flight guard below. This matters most when `buildSidebar()` throws
   *after* `document.body.appendChild(container)` (sidebar.js:352) but *before* it attaches
   `_runningSubscriber` / `_memoryPollInterval` / `_rateLimitStorageListener` (lines 608–672) —
   a container in the DOM with none of its cleanup handles. `deactivateExtensionUI()` already
   guards each handle with `if (sidebarEl._x)` and removes the element unconditionally, so that
   half-built case tears down cleanly and a retry cannot produce a second sidebar.

**New in-flight guard, `_extActivating`** — deliberately a *separate* flag from `_extActivated`,
because the two now mean different things: `_extActivated` means "initialisation finished and
the UI exists" (only true at the very end), while something still has to stop a second call
arriving mid-`await` from starting initialisation a second time. Cleared in a `finally`, so a
thrown step cannot leave it stuck `true` — that would have recreated the exact same lockout one
flag over. Concurrent callers return immediately (with a log line) rather than awaiting the
in-flight run; no current caller depends on the returned promise meaning "UI is ready"
(`onAuthGateChange` only attaches a `.catch`, and the startup IIFE does nothing after its
`await`).

**Errors are now caught rather than propagated.** The `.catch()` at the `onAuthGateChange` call
site is left in place as a safety net but will no longer fire for these three steps. Side
benefit: the startup IIFE's `await activateExtensionUI()` had **no** catch, so a throw there was
previously an unhandled promise rejection.

**Out of scope, deliberately unchanged:** what `tabState.init()`/`buildSidebar()` do, the order
of the steps, any naming, and any user-visible error UI (a visible failure signal was explicitly
not approved — the failure is console-only for now).

**Verification.** No browser available in the execution environment; the 6-point smoke checklist
was **NOT RUN**. `node --check` passes. Control flow was proved with a Node harness that slices
the **real** source text of `_extActivated` … end of `deactivateExtensionUI()` out of
`content/content.js` and evals it against stubs (rather than testing a copy that could drift):
44 checks covering happy path, `tabState.init()` throwing, `buildSidebar()` throwing both before
and after it appends the container, retry-after-failure for both failing steps, three concurrent
calls, concurrent calls where the first fails, and deactivate→activate. All pass. The stubs
model DOM/Chrome effects as counters, so this proves flag/teardown/re-entrancy logic only — real
DOM, real `chrome.storage`, and real Amazon page behaviour still need TC-AUTH-8 run by hand.

**Adjacent race found, NOT fixed** (separate bug, outside this task's one-fix scope): a logout
arriving *while* activation is in flight is still not handled. `deactivateExtensionUI()`
early-returns because `_extActivated` is false during the flight, then the in-flight activation
proceeds to build a sidebar for a logged-out session. This was equally broken before the fix
(the flag was true, so teardown ran against nothing and `buildSidebar()` then ran anyway,
leaving a sidebar with the flag `false`). Needs its own decision — likely a post-`await` gate
recheck via `isAuthGateActiveSync()`.

**Also noted, NOT fixed:** `buildSidebar()` appends `<style data-testid="ext-sidebar-styles">`
to `document.head` (sidebar.js:214) and `deactivateExtensionUI()` never removes it, so every
deactivate→activate cycle leaves another copy behind. Pre-existing, cosmetic (the rules are
identical), and touching it would mean changing the teardown this task said to reuse as-is.

### 2026-07-30 — PII log sweep finished; sidebar shows the shipped extension name

Mechanical batch: log-payload and string edits only. No control flow, no parser logic, no
renames. Logger call count is byte-identical before and after (183 log / 55 warn / 60 error /
5 debug = **303**).

**PART 1 — remaining personal data removed from logs.** Same rule as the previous task: the
call stays, the value goes, each site still shows that the step ran and whether it worked.

*Emails (4 named sites):* `authGate.js` `'gate transition'` → `hasEmail` boolean (this one
fired on every login/logout in **every open tab**, the widest email leak in the codebase);
`popup.js` `verifyOtp` → `emailLength` + `codeLength`; `resend signInWithOtp` → `emailLength`;
`restorePendingOrEmailStep` → `emailLength`. The stored email is still used to prefill the
input and status line — only the log lost it.

*Addresses:* `patModal.js` — the `'city source comparison'` log (full street addresses for
both stops, the largest remaining leak) plus the two `originStop`/`destStop` fallback warns.
`patApi.js` — **13 sites, not the 5 in the task list.** The extra 8 found during the sweep:
`parseBoardStop` entry (raw station code + CITY, ST ZIP), `resolvePATCity called (pre-parsed)`
and `(board string)`, the four `prefix+subsequence` fallback logs — one of which emitted a
**list of candidate city names** — and `submitOrder`, which logged the **entire PAT payload**
including the resolved origin/destination city objects. All now emit lengths, booleans, and
counts only.

**`city source comparison` — diagnostic purpose preserved, not dropped.** Per its own comment
the log exists to confirm which source supplied the city, because board stops can carry an
unstripped state-code prefix that `parseBoardStop` mishandles. It now reports whether the two
sources **agree** (does the board string contain the detail-parsed city, case-insensitively —
a boolean), whether the detail source parsed at all, and both lengths. The agreement test is a
pure inline helper that exists only to build this payload: it deliberately does **not** call
`parseBoardStop`, which would add work and trigger that function's own log.

**PART 2 — `EXT_NAME` is now `'Torren Relay'`** (`utils/constants.js`), was
`'Amazon Relay Helper'`. **Sole reader across the entire codebase** is
`content/sidebar.js:225` → `ext-sidebar-title`; verified by grep across `content/`, `utils/`,
`popup/`, `background.js`, and the HTML/CSS. `manifest.json`'s description is deliberately
untouched. `docs/UI_ELEMENTS.md`'s `ext-sidebar-title` row updated.

**Verified** (no browser — see the report for the manual list): `parseDetailAddress` and
`parseBoardStop` were **executed** against 7 real address strings each (street addresses,
station-coded board stops, full-state-name and hyphenated-ZIP variants, garbage, empty) with
the log payloads captured and asserted to contain no street number, city, state, or postcode,
and never the raw input verbatim — while return values were checked unchanged against golden
values for all 9 parse cases. The agreement helper was unit-tested including the exact
state-prefix defect the log exists to catch. 59/59 total. `node --check` clean on all five
touched files.

**Still outstanding, reported not fixed:** two non-PII raw-value logs remain in `patApi.js` —
`resolveLoadingType` (`"Drop"`/`"Live"`) and `parsePatStopTime` (`"07/10 10:42 EDT"`). Neither
is an email, address, postcode, name, or token; the timestamp carries a timezone abbreviation
only. Left in place deliberately.

### 2026-07-30 — DEBUG_LEVEL now gates all four logger methods; PII removed from three log sites

Two related audit findings, fixed together because level gating alone would still leak the
dispatcher's email and street addresses whenever the level was raised.

**FIX 1 — real level gating (`utils/logger.js`, `utils/constants.js`).** Only `logger.debug`
consulted `DEBUG_LEVEL`. With 183 `logger.log` calls against 5 `logger.debug`, the knob
silenced ~3% of output and the console stayed fully verbose at every setting. All four
methods now gate on it:

| level | emits |
|---|---|
| 0 | silent |
| **1** | error only — **shipped default** |
| 2 | error + warn |
| 3 | error + warn + log |
| 4 | everything, incl. debug |

`DEBUG_LEVEL` stays in `utils/constants.js`, commented as the single line to raise while
developing. No UI added. No call signature changed, no logger call removed, renamed, or
re-tagged — the count is identical before and after (183 log / 55 warn / 60 error / 5 debug =
303). A `typeof` guard makes the level read fall back to 1 if `constants.js` ever fails to
load first: reading an undeclared `DEBUG_LEVEL` directly would throw a `ReferenceError` and
turn every log call in the codebase into a crash, which the old `log`/`warn`/`error` could
never do.

**FIX 2 — PII removed from the three named sites.** Level gating is not sufficient; the value
is gone entirely, so it cannot surface at level 4 either.
- `content/content.js` — `'auth gate open', { email: gate.email }` → `{ hasEmail: !!gate.email }`.
  Still shows whether the session carried a user record.
- `popup/popup.js` — `'signInWithOtp', { email }` → `'signInWithOtp requested', { emailLength }`.
  Still distinguishes a real submit from an empty one.
- `content/patApi.js` — `parseDetailAddress` emitted the raw street address in **two** calls
  (entry and the no-match warn). Both now emit `hasInput`/`inputLength`/`matched` only. The
  task named the entry call; the warn was included because "log whether it succeeded" covers
  the failure path and it leaked the identical value.

**Verified** (no browser — see the report and TEST_CASES for the manual list): the real
`logger.js` was loaded into a VM with a captured console and exercised at levels 0–4 —
each level emits exactly the expected channels, level 1 emits errors only, and level 4 is
byte-equivalent to the old behaviour (old `log`/`warn`/`error` unconditional + `debug` at
`DEBUG_LEVEL>=2`). Missing-`DEBUG_LEVEL` fallback and data-less calls confirmed not to throw.
`parseDetailAddress` was executed against five real address strings and the captured log
payloads asserted to contain no street number, city, state, or postcode, and never the raw
input verbatim — while still reporting that the step ran and whether it matched, with parsing
output unchanged. Logger call counts identical before/after. `node --check` clean on all five
touched files.

**Not fixed, reported only** — the sweep for other PII/token logs found 5 further sites (see
the task report): `authGate.js:76`, `popup.js:190`, `popup.js:278`, `popup.js:304` all emit an
email; `patModal.js:468` emits full origin/destination addresses. `patApi.js` lines 200-320
emit city/state only.

### 2026-07-30 — waitForSheet() is now single-flight: rapid card switching can no longer render the wrong load

**Fixes exactly one audit finding** (`inlinePanel.js:400-419`). Nothing else touched.

**What was wrong:** `waitForSheet()` created a bare `setInterval` per call with no stored
handle and no cancellation. Clicking card A then quickly card B left **both** pollers alive.
A's poller was waiting for the sheet fingerprint to change away from A's — and B's sheet
loading is exactly what changes it. So A's poller declared itself ready and called
`showInlinePanel(cardA)`, which reads whatever sheet is currently in the DOM: **card B's**.
The panel then showed card A's position with card B's stops, payout, and distance, and
`showInlinePanel` merged that data into `loadStore` under A's `loadId`. A dispatcher could
open the PAT modal from there and post a truck against the wrong load's data entirely.
Confirmed by replaying the old function in a sandbox: two live timers, render order
`["A","B"]`.

**Implementation** (`content/inlinePanel.js` only):
- Three module-level fields replace the anonymous interval: `_sheetPollInterval` (so a run
  can be cancelled), `_sheetPollToken` (monotonic run id), `_sheetPollCard` (the card the run
  belongs to).
- New `cancelSheetPoll()` — clears the interval **and bumps the token**. The token bump is
  the part that matters: `clearInterval()` alone does not stop a tick already queued on the
  event loop, and that queued tick was one of the ways the wrong panel got rendered.
- `waitForSheet()` calls `cancelSheetPoll()` before starting, so at most one run exists.
  Three guards stop a superseded run from reaching its callback: a token check at tick entry,
  a second token check immediately before firing, and a card check (`_sheetPollCard === card`
  **and** `document.contains(card)`). Discards are silent — a superseded click is not an error.
- The `document.contains(card)` half is safe by construction: `showInlinePanel()` renders via
  `cardElement.parentNode.insertBefore(...)`, which already throws on a detached node today,
  so this only converts a caught exception into a deliberate discard — it cannot suppress a
  render that previously worked.
- `removeInlinePanel()` now calls `cancelSheetPoll()`. That single site covers logout and
  every bail-out checkpoint, because `content.js`'s `clearPipelineDom()` calls
  `removeInlinePanel()`, and `clearPipelineDom()` is called both by `deactivateExtensionUI()`
  and by all seven `shouldContinue()`-failing checkpoints in `runDetectionPipeline`. It also
  covers the toggle-off path.
- Timeout guard: the interval is cleared on **both** resolve and the existing 1500ms timeout,
  and the handle nulled, so no orphan can survive either way. Firing the callback on timeout
  is pre-existing behaviour and was deliberately preserved — but it is now subject to the same
  staleness guards, so a superseded run stays silent even at its own timeout.

**Scope note:** the `card` parameter is optional; a `waitForSheet(cb, fp)` call with no card
still behaves as before (token guards only). The one production call site now passes it.

**Verified:** 31/31 in a Node sandbox driving the *real* extracted `waitForSheet()` /
`cancelSheetPoll()` against a controllable clock and fake sheet — the exact A-then-B
interleaving (start A, start B, resolve after B: **A never renders**, exactly one timer, one
render); the queued-stale-tick race; card-detachment and identity discards; teardown
cancellation and idempotency; timeout cleanup including a superseded run's timeout; and the
no-card backward-compatible path. **The same TC-1 scenario was replayed against the pre-fix
function and does reproduce the bug** (`["A","B"]`, two live timers) — the regression test
demonstrably detects it rather than passing vacuously. `node --check` clean.

### 2026-07-30 — PAT modal: unreadable distance / stop count no longer post fabricated values

**Fixes exactly one audit finding** (the top-ranked one, `patModal.js:493-499`). Nothing else
in the audit was touched.

**What was wrong:** `distMiles = parseNumStr(loadUnit.distance)` used a failure sentinel of
`0` (`parseFloat(...) || 0`), indistinguishable from a genuine zero. An unreadable distance
therefore produced `minMiles = max(0, 0-25) = 0` and `maxMiles = 0+25 = 25`, and
`stopCount = parseInt(...) || 0` produced `0` stops. Those fabricated numbers were posted to
the **live marketplace** with no warning and no gating: `updateConfirmEnabled()` gated payout
and times only, and the submit-time check validated the *derived* min/max (which pass
happily) rather than their origin. This is the same class of bug already fixed for Payout
(2026-07-20) and for load times — the no-silent-fallback rule simply hadn't been applied here.

**Implementation** (`content/patModal.js` only):
- New local `parsePatMilesOrNull()` — same normalization as `parseNumStr` ("1,233.2 mi" →
  1233.2) but returning **`null`** on unparseable input, so "unreadable" and "zero" are
  distinguishable. A genuine `"0 mi"` still returns `0`.
- Unreadable distance → Min/Max Miles render **empty** (not 0/25), a visible
  `ext-pat-distance-warning` appears ("Load distance could not be read — enter it manually"),
  and Confirm is disabled until both fields hold a coherent pair.
- Unreadable stop count → the Stops slot renders a **number input** instead of the static
  "0 Stops" div (same `data-testid="ext-pat-stops"`; only the element type varies), with a
  visible `ext-pat-stops-warning` and Confirm disabled until a value ≥ 1 is entered. A parsed
  count still renders exactly the read-only display it did before.
- `updateConfirmEnabled()` now also gates on `stopsOk` / `milesOk`. Min/Max Miles previously
  had **no input listeners at all**, so nothing re-evaluated Confirm when they were edited —
  added.
- Submit path: new `currentStopCount()` resolves the parsed *or* manually-typed count and
  returns `null` (never `0`) when unknown; `formState.stopCount` now takes that value, and a
  last-line-of-defence check blocks submission if it is null.
- Warnings only appear for the genuinely-unreadable case — clearing a *prefilled* field
  disables Confirm but shows no "could not be read" message, which would be untrue.

**Interpretation flagged:** the brief asked for a `blockingErrors` entry, but `blockingErrors`
is permanent for the modal instance (`confirmBtn.disabled = blockingErrors.length > 0 || …`),
which would contradict the brief's own requirement that the dispatcher be able to type valid
values and proceed. Implemented instead with the live-recoverable gate that Payout and times
already use — whose own comment explains exactly this reasoning — so Confirm stays disabled
until corrected, then re-enables. Same visible outcome, minus the permanent lockout.

**Sentinel inventory** (for the future unification task — the other three were deliberately
NOT changed here): `patApi.js parseNumStr` → **`0`**; `priceSurge.js parsePayoutNumber` →
**`NaN`**; `loadStore.js _parsePayoutNum` → **`null`**; `content.js` inline sort parser →
`NaN` coerced to **`-Infinity`**. This fix adds a fourth call site using **`null`**
(`parsePatMilesOrNull`, PAT-modal-local), matching `loadStore`'s convention — the one to
standardise on, since it is the only sentinel that cannot be confused with a real value.

**Verified:** 66/66 in a Node sandbox running the *real* extracted `parsePatMilesOrNull()`
and asserting the gate/submit logic: sentinel behaviour incl. genuine-zero vs unparseable,
empty Min/Max on failure, stop-count NaN/<1 → null, Confirm disabled for each failure mode
and re-enabled after valid manual entry (individually and combined), payload carrying the
typed value, existing payout/times/blockingErrors gates unregressed, and that all three other
parsers are byte-unchanged. `node --check` clean.

### 2026-07-30 — Full-codebase audit: Part B auto-fixes only

Full read-only audit of `content/`, `utils/`, `popup/`, `background.js`, `manifest.json`,
and `docs/`. **Findings were reported separately and deliberately NOT fixed** — only the
narrow auto-fix class the audit brief authorised was changed. Everything below is one of:
dead CSS matching no element, an unused declaration, a string literal that should use an
existing constant, or a duplicated identical CSS declaration. No refactors, no behaviour
changes, and nothing touching Fast Book or `FORBIDDEN_SELECTORS` (explicitly out of scope).

**1. `content/inlinePanel.js` — removed 2 dead CSS rules.**
`.ext-inline-panel__header` and `.ext-inline-panel__header .ext-payout`. Neither class is
assigned to any element anywhere in the codebase (`buildPanelElement()` never creates a load
header), so both rules matched nothing. They were added speculatively earlier on 2026-07-30
and were already flagged as dead in their own comment.

**2. `content/nightMode.js` — removed 2 duplicated identical CSS declarations.**
`html.ext-night #ext-sidebar [data-testid="ext-playpause"]` and
`html.ext-night #ext-sidebar .ext-scanline__seg` were byte-identical in value to rules
`content/sidebar.js` already injects for the same selectors. `sidebar.js` is the correct
owner — both selectors only match inside `#ext-sidebar`, which only exists once
`buildSidebar()` has injected that stylesheet. **Side effect worth noting:** the removed
scanline copy carried `!important`, which was overriding `sidebar.js`'s
`@media (prefers-reduced-motion: reduce)` rule (that one is not `!important`). Reduced-motion
users in night mode were still getting the animated gradient; removing the duplicate restores
the intended static fallback.

**3. `popup/popup.js` — 14 string literals replaced with the existing `STORAGE_KEYS`
constants.** `KEY_NIGHT_MODE`…`KEY_SHARED_LIMIT` were hardcoded copies of the storage-key
strings, each carrying a comment naming the constant it duplicated — two places to keep in
sync, and a silent-desync risk if a key were ever renamed in `utils/storage.js` (the popup
would keep reading the old key while every content script moved to the new one). Now derived
from `STORAGE_KEYS` directly. `utils/storage.js` loads before `popup.js` (see `popup.html`),
so the constants are defined at that point. The local aliases are kept so the ~60 usages
below stay untouched.

**Unused variables/constants: none removed.** The one candidate class in the brief turned up
no zero-reference declarations — every constant checked (`PAT_EQUIPMENT_TYPES_*`,
`REFRESH_PATH_D`, `ABBREV_EXPAND`, `TZ_OFFSET_HOURS`, `DK_FAINT`, `DK_CHIP_BG`, `EXT_NAME`,
`EXT_VERSION`, `refreshDryRun`, `resetKnownLoads`, `getAllLoadUnits`, `sortByPayoutDesc`,
`ALLOWED_CLICK_INTENTS`, `AUTH_PENDING_KEY`) has at least one live reference.

**Verified:** `node --check` clean on all three edited files. The 14 popup keys were
re-evaluated in a VM sandbox and confirmed to resolve to byte-identical strings. Both edited
stylesheets were regenerated by running the real `buildNightCss()` / `injectPanelStyle()` and
asserted on: removed rules absent, retained rules present, brace balance intact.
**Not verified:** any of this in a browser — no rendering check was possible in this
environment.

### 2026-07-30 — Accordion leg cards: full-width action bar, light leg-header colour, fixed-column route alignment

**Ask (CSS-only — no HTML/JS changes):** (1) the bottom action bar had a 10px horizontal
inset instead of spanning the card edge-to-edge; (2) the leg-header bar was dark navy —
replace with a light grey-green-blue and invert its text/icon colors accordingly; (3) the
route group (badge/code/arrow/badge/code) had no fixed column structure, so arrows landed at
different x-positions leg to leg depending on city-name length; (4) map every new color to
an existing dark token and report any leaks.

**State reported before changing (per instruction):**
- Leg-header background token: `var(--ext-leg-navy)`, `utils/designTokens.js:44`,
  `#1B3A57`, `:root`-only (deliberately no dark override — see its own comment: `nightMode.js`
  already overrides `.ext-seg-header`'s background directly).
- Action bar spacing: `.ext-action-bar{padding:5px 10px;...width:100%;box-sizing:border-box;...}`
  — already full-width at the box level; the 10px was a content inset, not a width shortfall.
- Route group markup: `.ext-seg-route` (flex, `gap:8px`) contains, in DOM order, `.ext-stop-num`
  (origin badge) → `.ext-route-origin` (code) → `.ext-route-arrow` → `.ext-stop-num` (dest
  badge — **same class as the origin badge, no distinct class**) → `.ext-route-dest` (code).
  No fixed widths; a short code shifts everything after it.

**Implementation (`content/inlinePanel.js`, `content/nightMode.js`, `utils/designTokens.js`):**
- **Action bar:** `.ext-action-bar` horizontal padding `10px → 0`; the wrapper's own
  background/border already spanned full width (`width:100%`/`border-box`), so this was
  purely a content-inset fix, not a width fix. New
  `.ext-action-bar > .ext-action-btn:first-child{margin-left:16px;}` puts the first icon
  16px from the card's left edge, per spec ("icons keep their own internal padding" —
  `.ext-action-btn` itself, 28×28/`padding:0`, is untouched). **Judgment call, flagged:**
  the right edge (where Fast Book sits, via its own `margin-left:auto`) is now flush against
  the card's right border with zero gutter — it had the same 10px as the left side before.
  Not compensated, since only the left-start position was specified; revisit if symmetric
  spacing is wanted.
- **Leg-header colour:** token renamed `--ext-leg-navy` → `--ext-leg-header-bg` (no longer
  navy) and recolored `#1B3A57 → #DCE6E9` in `designTokens.js`. `.ext-seg-header` gets a new
  `border-bottom:1px solid #C4D2D6` and its base `color` flips `#ffffff → #1F3A45`. Per-element
  colors set explicitly: `.ext-route-origin`/`.ext-route-dest` → `#1F3A45`/`font-weight:600`;
  `.ext-seg-dist` → `#4A6570`; chevron (`.ext-seg-header .ext-seg-arrow`) → `#4A6570` (new —
  previously unset, relying on inheriting the header's own color). `.ext-route-arrow` (the
  connecting "→", not spec'd explicitly) inferred to `#4A6570` to match the distance/duration
  weight — **flagged as a judgment call**, easy to change if a different tone was intended.
  Status pills (`.ext-seg-action`/`.ext-seg-loaded`/`.ext-seg-empty`) intentionally
  **untouched** per spec ("keep their existing pill colours") — **flagged for manual visual
  check**: the Empty pill's background (`#F3F4F6`) is close in lightness to the new header
  background (`#DCE6E9`) and may read as low-contrast without a border; not added since it
  wasn't asked for.
- **Route group alignment:** `.ext-seg-route` converted from flex to `display:grid;
  grid-template-columns:170px 28px 170px` (origin / arrow / destination), `margin-left:24px`
  (on top of `.ext-seg-header`'s own 16px padding = 40px total from the card edge, per spec).
  Since the two badges share one class, they're disambiguated by DOM position —
  `.ext-seg-route > .ext-stop-num:nth-child(1)` (origin) and `:nth-child(4)` (destination) —
  each placed in the SAME grid-column as its adjacent code span (badge + code = one visual
  170px cell), with `.ext-seg-route > *{grid-row:1}` forcing every child onto one row (without
  it, the grid auto-placement algorithm bumps a same-column item to a new row instead of
  layering it into the shared cell). The code spans keep default `justify-self:stretch` +
  `margin-left:26px` (18px badge + 8px gap), which resolves to a definite `144px` box — that's
  what makes `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` actually truncate
  long names ("GAHANNA, OH") instead of overflowing; replaces the old multi-line
  `overflow-wrap`/`word-break`. The arrow gets its own `28px` column, `justify-self:center` —
  this is what makes every leg's arrow land in one vertical line, the core ask. Removed the
  now-dead `.ext-seg-route .ext-stop-num{margin-right:0}` override (existed only to cancel
  the old flex gap; the grid's spacing comes from the code span's margin, so it did nothing
  either way once the flex gap was gone).
  **Known trade-off, flagged:** the route group's minimum content width is now a fixed
  `170+28+170+24(indent)=392px`, inside a header column that's `34%` of the card's width — it
  only fits without overlapping the adjacent header columns on cards ≥ ~1150-1200px wide.
  This is an inherent consequence of "fixed pixel alignment inside a fluid header," not a bug;
  needs the manual narrow-card check below.
- **Dark mode (`content/nightMode.js`):** `.ext-seg-header`'s background/border/color,
  `.ext-route-arrow`, `.ext-seg-dist`, the status pills, and `.ext-action-bar` already had
  `!important` overrides from the earlier 2026-07-30 redesign — untouched, still correct.
  **Two NEW overrides added**, because a plain (non-`!important`) light-mode rule beats
  inheritance in every theme, not just light — without these, the new hex would have leaked
  straight into dark mode:
  - `.ext-route-origin`/`.ext-route-dest` → `DK_TEXT` (previously these had no explicit color
    at all and simply inherited the header's; now that light mode gives them one, dark mode
    needs its own or it would inherit the new `#1F3A45` — near-unreadable dark-on-dark against
    the `DK_HIGH` header background).
  - chevron (`.ext-seg-header .ext-seg-arrow`) → `DK_MUTED` (same leak risk, same fix,
    mapped to the same token already used for the connecting arrow — both are secondary
    glyphs, not primary text).

**Verified (no browser in the build environment — see TEST_CASES.md for the manual list):**
44/44 on a harness that runs the ACTUAL `injectPanelStyle()`/`buildNightCss()` functions (not
re-implementations) and asserts on the real generated CSS string: brace balance; the token
rename is complete (`--ext-leg-header-bg` present, `--ext-leg-navy` fully gone); every color
value listed above appears on the correct selector; the 170/28/170 grid template and 24px
margin math; every child's exact `grid-column`/`grid-row` placement; the dead badge-margin
rule's removal; the action-bar padding and first-icon margin; and — the main risk in a
CSS-only, no-DOM-inspection task — a simulated cascade proof that each of the two new
`nightMode.js` overrides actually wins against its corresponding light-mode rule (not just
"a rule exists somewhere," but that it resolves to the dark token, not the light hex).

**Ask:** the paused banner read `"Paused — Amazon rate limit. Retrying in 278s"`. That number
is misleading — it is *our own* backoff timer, not Amazon's unblock time. It restarted from
scratch on every page reload, and reaching zero changed nothing visible. Remove the number,
keep the retry/backoff machinery untouched, replace the copy, add an "i" tooltip with the
fuller explanation, and keep the banner up until a request actually succeeds.

**Where the countdown came from (reported before changing it):**
`content/sidebar.js` → `updateRateLimitDisplay()` built the string as
`'Paused — Amazon rate limit. Retrying in ' + formatCountdown(backoffUntil - now)`, redrawn
every second by a dedicated `setInterval(updateRateLimitDisplay, 1000)` stashed on the
container as `_rateLimitPollInterval`. `backoffUntil` is written by `background.js`
`reportResult()` — `Date.now() + jitter(5/10/20/40/80s, capped 300s)`.

**Implementation:**
- **`background.js`** — new `rateLimited` boolean on the `extRateLimiterState` record. Set
  `true` on every reported failure, `false` only on a reported 2xx. It is a **display flag
  only**: no pacing, permit, or backoff code path reads it. Needed because `backoffUntil`
  answers a different question than the banner does — the timer expiring means "we may retry
  now", never "Amazon lifted the block". **Backoff timing itself is unchanged** (verified by
  A/B against the committed file, see below).
- **`content/sidebar.js`**
  - `formatCountdown()` deleted; banner text is now static and split into
    `ext-rate-limit-text` (the sentence, ellipsised when cramped) plus a trailing
    `ext-rate-limit-info` "i" carrying `ext-rate-limit-tooltip`. The banner became a flex
    container so the icon sits immediately after the sentence instead of being pushed to the
    far right by `flex:1`.
  - New `isRateLimitPaused()` reads the sticky flag, with a fallback to the old timer test
    for state written by a build predating the field (transient — `background.js` writes the
    field on the next reported result). `adoptRateLimitState()` is now the single copy point
    shared by the async seed and the `onChanged` listener, so the two cannot drift.
  - **The 1s `setInterval` is gone**, along with `_rateLimitPollInterval`. Nothing needs a
    clock any more: every paused-state transition arrives as a `chrome.storage.onChanged`
    event. `content.js`'s `deactivateExtensionUI()` dropped the matching `clearInterval`.
  - `renderSharedRateStatus()` now shares `isRateLimitPaused()` instead of computing its own
    `backoffActive`, so row 2 and the banner can never disagree about being paused.
  - **`#ext-sidebar` changed from `overflow:hidden` to `overflow:visible`.** Both info
    tooltips are absolutely positioned *below* the bar and were being clipped away entirely
    — meaning the pre-existing `ext-memory-tooltip` has never actually been visible either;
    this fixes that too. `position:fixed` would not have escaped the clip, because the bar's
    `transform` makes it the containing block for fixed descendants. Nothing depended on the
    clip (the scanline has its own `overflow:hidden`). Also added
    `max-width:calc(100vw - 16px)`, since the much longer banner text would otherwise grow
    the auto-width, centre-anchored bar off both edges of a narrow viewport.
  - Info-icon geometry, `:focus-visible` ring, tooltip box, and the night-mode tooltip
    override are now shared selectors covering both icons rather than duplicated rules. The
    rate-limit "i" overrides fill/border to `currentColor` so it reads as part of the amber
    banner (and therefore needs no night-mode override — that amber is already
    theme-independent by design).
- **`utils/storage.js`** — documented the full `extRateLimiterState` shape including the new
  field.

**Behaviour change beyond the literal ask, flagged deliberately:** play/pause now **stays
visible** while paused (it used to be hidden alongside the slider). Forced by requirement 5:
once the banner only clears on a successful response, and a stopped extension issues no
requests, hiding the one control that can restart it could strand the dispatcher with a
permanent banner and no way to act on it. Slider and slider-value still hide as before.

**Verified (no browser in the build environment — logic only, see TEST_CASES.md):** 50/50 on
a DOM-stub harness driving the real `buildSidebar()` (exact banner and tooltip copy, no
digits-plus-`s` anywhere in the banner, show on failure / **stay shown after the backoff
timestamp passes** / hide on the success record, reload re-seed, legacy-state fallback,
hover + focus + tap tooltip toggling, testids/roles, and that exactly one interval — the 7s
memory poll — is still created). 13/13 on `background.js`, including an A/B that runs the
identical failure sequence against the committed file and this one with jitter pinned:
schedules match exactly (5/10/20/40/80s → capped 300s → reset to step −1), and the sticky
flag provably does not gate permits. **CSS layout/appearance is not machine-verifiable
here** — see the manual list in TEST_CASES.md TC-RATELIMIT-3.

### 2026-07-30 — Shared-limit UX: mode-aware slider label + live "Active tabs: N" status line

**Ask:** the refresh-speed slider showed e.g. "2.0s" regardless of shared-limit mode, even
though shared mode paces tabs differently (each tab's real cadence is `interval × N`, not
`interval`) — confusing. Make the slider's meaning explicit per mode, and add a live status
line showing N and the derived per-tab cadence, sourced from wherever the permit system
already tracks N.

**Wiring reported before coding (per instruction) — and a real gap found:**
- The slider's visible text was just the bare number (`sliderValue.textContent =
  seconds.toFixed(1) + 's'`), written in 3 places (async seed, live cross-tab sync, the
  slider's own `input` handler) — no descriptive label existed; only `title`/`aria-label`
  tooltips carried any context.
- **"The same source the permit system uses for N" doesn't exist.** Re-read `background.js`
  in full — there was, and is, zero tab-count tracking. The previous pacing fix
  (2026-07-30, earlier same-day entry) deliberately achieves `interval × N` per-tab cadence
  through pure FIFO contention on one shared floor, with no tab count anywhere. Built a new
  registry now, specifically for this display — pacing itself is untouched.
- `#ext-sidebar` was a fixed single-row, 40px bar with `overflow:hidden` — no capacity for a
  second line. Restructured into a 2-row flex-column layout.

**Implementation:**
- **`background.js`** — new active-tab registry, `{tabId: lastSeenAt}` under
  `extActiveTabs`, persisted (survives SW eviction, same reasoning as `RATE_LIMITER_KEY`).
  Heartbeated on every existing `REQUEST_PERMIT` call (`sender.tab.id` — no new message
  needed for this). Immediate removal on `chrome.tabs.onRemoved` (tab closed) and on a new
  `RELEASE_TAB` message. A 20s stale-entry prune is a safety net only (crash/navigate-away
  without a clean event) — primary removal is always immediate. Serialized through its own
  queue-tail (mirroring `permitQueueTail`) to avoid a read-modify-write race between two
  tabs heartbeating near-simultaneously. Derived count written to `extActiveTabCount`
  (`{count:N}`) on every registry change — this is the ONE thing content scripts read;
  nothing recomputes N independently.
- **`content.js`** — `stopOrchestrator()` now sends `{type:'RELEASE_TAB'}` (fire-and-forget).
  **Judgment call, flagged for review:** this fires on BOTH logout AND the dispatcher
  manually pausing (Play/Pause off) — the task only named open/close/logout, but a paused
  tab isn't in the round-robin, so counting it would make "each tab refreshes every X.Xs"
  wrong. `deactivateExtensionUI()` now also `document.body.style.removeProperty('padding-
  top')`, since the bar's height (and thus body padding) is now set via inline JS style, not
  purely the injected `<style>` tag — removing just the tag would no longer fully revert
  the page.
- **`utils/storage.js`** — new `ACTIVE_TAB_COUNT_KEY = 'extActiveTabCount'` (matching
  `background.js`'s own duplicated constant, same reasoning as `RATE_LIMITER_KEY`: live
  coordination state, not a preference, not in `STORAGE_KEYS`, not cleared by Reset).
- **`content/sidebar.js`** — `#ext-sidebar` is now `display:flex;flex-direction:column`
  (was a single fixed-height row): row 1 (`.ext-sidebar-row1`, all existing controls,
  unchanged) plus row 2 (`data-testid="ext-shared-rate-status"`, new, hidden by default).
  Bar height is two discrete states (40px, or 40+20px) rather than a measured
  `getBoundingClientRect()`, so body padding can be set synchronously with no reflow-timing
  race. `renderModeLabel()`: OFF → `"Refresh every X.Xs"`, ON → `"Shared rate: 1 refresh /
  X.Xs"`. `renderSharedRateStatus()`: visible only when mode ON **and** backoff is not
  active — **requirement 4 interpreted as**: during backoff, row 2 hides rather than
  literally hosting the countdown text, since row 1's existing banner already fully takes
  over the messaging (showing the same information in two places at once would be
  redundant/conflicting). N===1 gets the singular phrasing exactly as specified ("1 active
  tab → refreshing every X.Xs"); N>1 gets "Active tabs: N → each tab refreshes every X.Xs".
  `_sharedLimitEnabled`/`_activeTabCount` are new local caches (sidebar.js didn't
  previously know the mode at all), seeded + live-synced via the same
  `chrome.storage.onChanged` pattern already used for the interval and backoff state — no
  polling message added; `extActiveTabCount` changes push instantly, same as backoff does.
  **Bug found and fixed while implementing, not requested but necessary**: the file still
  had a static `body{padding-top:44px!important}` CSS rule from the original single-row
  design — removed it (redundant/misleading now that JS always sets this dynamically) and
  added a synchronous `syncBodyPadding(false)` call right after the DOM is built, so the
  page is never unpadded even for the brief window before the async storage seed resolves.

**Verified (Node `vm`, real logic — no browser available, see Verification rules):**
- 14/14 functional checks on `background.js`'s new registry: heartbeat registers/dedupes a
  tab; `chrome.tabs.onRemoved` and `RELEASE_TAB` both drop count immediately (not just
  decrement — confirmed the actual tab id is gone from the registry); stale-entry pruning
  works; pacing math is provably unaffected by the registry's presence (still ~5s/~300ms
  waits as before, per the earlier pacing-fix tests).
- **17/17 real functional checks against the actual `sidebar.js` source**, not just
  structural/regex checks: built a minimal but functioning fake DOM, ran the real
  `buildSidebar()`, and asserted on the real elements it created — OFF-mode label text,
  ON-mode label text, N=1 singular phrasing, N>1 plural phrasing with correct `interval×N`
  math, live re-render on `extActiveTabCount` changes (N: 1→4→1, catching any stale-text
  bug), live mode toggle with no reload, and backoff correctly hiding row 2 while showing
  the existing banner — plus body padding transitioning between 44px/64px correctly in
  every scenario.

**NOT verified — needs manual browser testing (no browser available in this environment):**
1. Visual check of the two-row bar — spacing, alignment, no clipping/overlap with the
   memory indicator/tooltip, in both themes (Night Mode on/off).
2. **The core ask**: open 2+ real tabs, confirm "Active tabs: N" updates live as tabs are
   opened and closed, with no stale/lagging count and no page reload needed.
3. Confirm N also updates live when a tab logs out or the dispatcher pauses it (Play/Pause
   off) — the paused-tab exclusion is a judgment call flagged above; if that's not the
   intended behavior, it's a small, isolated change (drop the `RELEASE_TAB` send from the
   pause path, keep it for logout only).
4. Confirm page content doesn't visibly jump/flicker when row 2 appears/disappears (mode
   toggle, entering/leaving backoff) — the height-swap is instant in the model, but real
   paint/reflow timing hasn't been observed.
5. Confirm `document.body`'s padding-top is fully cleared (page reverts to untouched) after
   a real logout, not just structurally confirmed via source inspection.

### 2026-07-30 — Leg header redesign (CSS-only): dark navy bar, pill badges, column-aligned grid

**Ask:** CSS-only polish pass on the segment leg header and expanded body, matching a
mockup goal (dark navy header, white body, pill status badges), with no HTML/JS structure
changes — all elements already exist.

**Wiring reported before coding (per instruction):**
- `.ext-seg-header` was `display:flex`, no grid — `margin-left:auto` on `.ext-seg-dist`
  consumed all free space between the left route group and everything after it, clustering
  distance/duration + load-type + status + chevron at the right edge and leaving an empty
  gap in the middle on wide cards. That's the reported bug.
- `.ext-inline-panel__table` uses 4 fixed `nth-child` percentage columns: Stop 34% /
  Equipment-Id 18% / Arrival 24% / Departure 24% (sums to 100%, no chevron column).
- The header's 5 DOM children (`.ext-seg-route`, `.ext-seg-dist`, `.ext-seg-action`,
  `.ext-seg-status`, `.ext-seg-arrow`) already line up 1:1 with the table's 4 columns plus
  a trailing chevron, in DOM order — so a matching grid needed zero HTML changes.
- **Gap flagged, not fixed:** no "LEG N" text element exists anywhere in the DOM (a
  `.ext-seg-title` that may have held something like it was removed in the 2026-07-20
  polish pass — see inlinePanel.js's own code comment at the time). Only a numeric badge
  circle (`.ext-stop-num`) exists. Requirement 2's "uppercase the LEG N label" has nothing
  to apply to — not implemented, since fabricating one via CSS `content` would need a data
  attribute that doesn't exist (and arguably strains "no HTML structure changes"). Flagged
  for the user to decide: add the element (JS/HTML change, out of scope for this CSS-only
  pass) or drop the requirement.

**Implementation (`content/inlinePanel.js`, `content/nightMode.js`, `utils/designTokens.js`
— all CSS-only, no `buildPanelElement()`/`buildSegmentTable()` changes):**
- **`.ext-seg-header` → `display:grid`**, `grid-template-columns:34% 18% 24% calc(24% -
  24px) 24px`. Columns 1-3 exactly mirror the table's own percentages; column 4's *left*
  edge still lines up with the table's Departure column (only its right edge is trimmed by
  24px, carved out via `calc()`), and that 24px becomes column 5 — a genuinely separate,
  narrow trailing cell for the chevron, which the table has no equivalent of. `justify-
  items:start` keeps every item left-aligned/content-sized in its cell (matching the
  table's own left-aligned cell text) instead of stretching to fill it. Verified with real
  arithmetic (not just visual guessing) at 600px/900px/2000px card widths: header and table
  column edges land within floating-point tolerance of each other at every width, and the
  grid's total width matches the container exactly (no overflow) — see verification below.
  **Why the alignment actually works:** `.ext-seg-header` (`padding:10px 16px`) and
  `.ext-seg-body` (`padding:0 16px 12px`, see below) now share the exact same 16px
  left/right inset, so their content boxes — against which grid/percentage widths resolve —
  start at the same x-offset and have the same width.
- Background `var(--ext-leg-navy)` (new token, `#1B3A57`, added to `utils/designTokens.js`'s
  `:root` — deliberately no `html.ext-night` counterpart, see that file's comment: dark mode
  already themes this element via `nightMode.js`'s own `DK_HIGH` token with `!important`,
  which is documented there as "segment headers" in its own elevation ramp). Text white,
  weight 600, size 12px, letter-spacing 0.3px, padding `10px 16px`.
- Left group (`.ext-seg-route`): gap 6px → 8px per spec; dropped `flex:0 1 auto` (meaningless
  on a grid item, was flex-only).
- **Contrast fix required by the background change:** `.ext-route-arrow` and `.ext-seg-dist`
  both had dark-grey `var(--ext-n400)`/`var(--ext-n500)` text, correct against the old light
  grey header but unreadable against the new dark navy — changed to muted-white `rgba(255,
  255,255,.55)` / `rgba(255,255,255,.72)`. `.ext-route-origin`/`.ext-route-dest` had no
  explicit color and correctly inherit the new white from the container — no change needed.
- **`.ext-seg-body`**: `background:#FFFFFF` (explicit now, was previously only implicit via
  inherited `var(--ext-surface)`, which happens to already equal white in light mode —
  making it explicit matches the literal ask and doesn't depend on that coincidence
  continuing), `padding:0 16px 12px` — `.ext-seg-body` is the table's direct (and only)
  parent, so it doubles as "the table wrapper"; no separate wrapper element exists to target.
- **Pill badges**: `.ext-seg-action` (Live/Drop) `background:#E1EFFE;color:#1E429F`;
  `.ext-seg-loaded` `background:#DEF7EC;color:#03543F`; `.ext-seg-empty`
  `background:#F3F4F6;color:#374151`; shared mechanics (`border-radius:9999px;padding:2px
  10px;font-size:11px;font-weight:600`) on `.ext-seg-action`/`.ext-seg-status` (the base
  class `.ext-seg-loaded`/`.ext-seg-empty` share). Light pill on the dark header bar is the
  intended look — these are exact spec hex, not theme tokens, deliberately.
- **Table typography**: `th` → 11px, letter-spacing 0.5px, color `#6B7280`, background
  `#F9FAFB`, border-bottom `#E5E7EB` (was 10px/0.4px/`var(--ext-n500)`/`var(--ext-n100)`/
  `var(--ext-n200)`). `td` border-bottom → `#F3F4F6` (was `var(--ext-n200)`) — still no
  vertical column borders (none were ever added, unchanged). Stop code `<b>` → 15px/600/
  `#111827` (was 13px/`var(--ext-n700)`). `.ext-stop-addr` → 13px/400/`#6B7280` (was
  11px/`var(--ext-n500)`).
- **Night Mode (`content/nightMode.js`)**: verified per requirement 6.
  - Already correct, no change needed: `.ext-seg-header` (background/text via `DK_HIGH`/
    `DK_TEXT`), `.ext-stop-num`, `.ext-route-arrow`, `thead th`, `tbody tr`/`td` — all
    pre-existing `!important` overrides, confirmed to still apply cleanly against the new
    light-mode hex (they don't reference the light values at all, so nothing to break).
    `.ext-seg-body`'s new explicit `#FFFFFF` is caught by the existing blanket
    `body *{background-color:transparent !important}` universal reset — no leak, renders
    transparent over the panel's own dark overlay background in dark mode.
  - **Two real gaps found and fixed** (pre-existing, not introduced by this pass, but
    directly relevant to the "typography hierarchy" ask): `.ext-seg-dist` and
    `.ext-stop-addr` had no dark-mode color override at all, so they fell through to the
    universal rule's primary `DK_TEXT` instead of a muted secondary tone — added explicit
    `DK_MUTED` overrides for both.
  - **New elements needing coverage** (didn't exist as pill badges before): added
    `.ext-seg-loaded`/`.ext-seg-empty`/`.ext-seg-action` background overrides, reusing
    existing dark tokens only — `rgba(55,176,111,.18)` (derived directly from the existing
    `DK_SUCCESS` RGB, not a new arbitrary color) for Loaded, `DK_OVERLAY` (already the
    panel's own surface color) for Empty, `DK_ACCENT_BG`/`DK_ACCENT_TEXT` (already used for
    the stop-number badge circles) for the Live/Drop pill.
  - **No hardcoded hex leaks through in dark mode** — every new light-mode color introduced
    by this pass is either (a) explicitly overridden by an existing or newly-added
    `!important` dark rule, or (b) caught by the universal transparent/text-color reset.

**Verified (Node `vm` structural/source-text checks + real box-model arithmetic — no
browser available, see Verification rules):** 30/30 structural checks (exact CSS values
present, old hacks removed, Night Mode overrides present/correct). Separately, real
coordinate-geometry arithmetic (not visual guessing) confirms the header's grid column
edges land within floating-point tolerance of the table's column edges at 600px, 900px, and
2000px card widths (the exact width cited in the bug report), and the header grid's total
width exactly fills its container with no overflow.

**NOT verified — needs manual browser testing (no browser available in this environment):**
1. Visual confirmation the header now renders as a solid dark navy bar with no gap in the
   middle, at a realistic card width (including ~2000px, the width cited in the report).
2. Visual confirmation the left group, distance/duration, Live/Drop pill, and Loaded/Empty
   pill each sit directly above their corresponding table column when expanded — the math
   proof above is necessary but not sufficient (assumes no unaccounted browser rendering
   quirk, e.g. scrollbar width stealing from the content box).
3. Pill badges render as true rounded pills (not stretched/squashed) at both minimum and
   maximum realistic segment counts/text lengths (e.g. "Preloaded" in the Live/Drop slot,
   which is longer than "Live"/"Drop").
4. Night Mode toggle on/off with the panel expanded — confirm the navy header, white body,
   and pill badges all repaint correctly with no light-mode hex visibly leaking through
   (the "verify no hex leaks" ask can only be checked by rule presence here, not by looking
   at actual pixels).
5. Multi-segment loads — confirm alignment holds consistently across every segment's header/
   body pair, not just the first.
6. The "LEG N" label gap flagged above — needs a product decision (add the element, or drop
   the requirement) before any further work there.

### 2026-07-30 — Shared-limit pacing bug fix: 1 tab at 2s was actually refreshing every ~3.5s

**Bug report (with real measured data):** with the "Shared refresh limit" toggle ON and
only ONE tab open, the tab refreshed about every 3.5s even though the dispatcher's slider
was set to 2s. A single tab at 2s never triggered a 503 in prior testing, so shared mode
must never be slower than the dispatcher's own chosen setting.

**Wiring reported before coding (per instruction):**
- `background.js`'s pacing floor was `const GLOBAL_MIN_PERMIT_INTERVAL_MS = 5000` — a
  **hardcoded 5-second constant, unrelated to the dispatcher's slider value**
  (`globalRefreshIntervalMs`, adjustable 0.5s–8s). `grantOrDenyPermit()` paced every grant
  against `lastGrantedAt + GLOBAL_MIN_PERMIT_INTERVAL_MS` — so even a single tab requesting
  every 2s could be silently re-throttled toward a 5s cadence.
- **How N (active-tab count) was counted: it wasn't.** No registry, no heartbeat, no
  counter anywhere — permits were granted purely FIFO against one shared `lastGrantedAt`
  timestamp. This turned out not to be a gap that needed filling (see below).
- A second, independent cause of the reported 3.5s: `content.js`'s `scheduleNextTick()` set
  a **fresh** `globalRefreshIntervalMs` timer *after* `orchestratorTick()` fully finished —
  and that tick includes the permit round-trip, `refreshNow()`, `REFRESH_SETTLE_MS`
  (1200ms), and pipeline parsing. Real cadence was `interval + tick_overhead`, not
  `interval` — for 1 tab, `2000 + 1200(settle) + ~300(pipeline) ≈ 3500ms`, matching the
  reported number. This was likely the dominant cause, independent of the 5000ms floor
  (which for a single tab often wasn't even binding, since the tick's own overhead already
  exceeded it).

**Correct model implemented (dispatcher's interval = the global budget itself, not a
separate constant):**
- **`background.js`:** `GLOBAL_MIN_PERMIT_INTERVAL_MS` removed. New
  `getGlobalPacingFloorMs()` reads `STORAGE_KEYS.REFRESH_INTERVAL_MS`
  (`globalRefreshIntervalMs`) directly from `chrome.storage.local` on every call (falls back
  to 2000ms if missing/invalid) — the shared floor now IS the dispatcher's own chosen
  interval, re-read fresh so a live slider change takes effect for pacing immediately, not
  just for each tab's own local timer.
- **No explicit N-tracking added, deliberately.** With the floor set to the dispatcher's
  interval, FIFO fairness alone reproduces the requested model: with 1 tab, the floor is
  essentially never binding (a tab's own tick overhead already exceeds it once the
  overhead-compensation fix below is applied), so it refreshes at exactly the chosen
  interval; with N tabs competing for the same one-slot-every-`interval` floor, each tab
  statistically receives 1 grant in every N — i.e. `interval × N` per tab, with the combined
  rate across all tabs staying at 1 grant per `interval`, exactly as specified. A tab that
  closes or logs out simply stops sending `REQUEST_PERMIT` messages, so it drops out of the
  round robin **instantly** — no registry entry to expire, no TTL/staleness window, no risk
  of a stale entry inflating N after a crash. This is simpler and more immediate than an
  explicit counter would have been.
- **`content/content.js`:** new `lastTickElapsedMs` (module-level, starts at 0) records how
  long the just-finished tick actually took wall-clock (`tickStart` captured at tick entry,
  `lastTickElapsedMs = Date.now() - tickStart` set in the tick's `finally` block — not
  touched by the `orchTickRunning` overlap-guard's early return, since that's not a real
  tick attempt). `scheduleNextTick()` now computes
  `delayMs = Math.max(0, intervalMs - lastTickElapsedMs)` instead of scheduling a bare
  `intervalMs` timer — this is the literal "subtract permit round-trip overhead rather than
  let it accumulate" fix, generalized to the tick's *total* overhead (permit wait +
  `refreshNow()` + settle + pipeline), since the settle/pipeline time dominates the permit
  round-trip itself and both need subtracting for the cadence to actually match the chosen
  interval. When a tick's overhead exceeds the interval (e.g. it had to wait for another
  tab's turn), the next attempt fires immediately (floored at 0) instead of waiting a full
  extra interval on top — this is also what lets a tab "catch up" quickly after losing a
  contention round, contributing to the N-tab fairness above.
- No new artificial safety floor was added below the slider's own 0.5s minimum — per the
  "dispatcher's interval IS the budget" model, their own setting is now authoritative. The
  protection against the original 503 bug is preserved entirely by the shared floor: no
  matter how many tabs are open, the **combined** request rate across all of them never
  exceeds 1 per chosen interval — that's what actually prevented the original failure (many
  tabs each independently polling at full, uncoordinated speed).

**Verified with real functional tests (Node `vm` loading the actual `background.js`, plus a
faithful simulation of `content.js`'s own compensation algorithm — real wall-clock timing,
not mocked clocks; no browser available, see Verification rules):**
- 1 tab at a 2000ms setting (1500ms simulated settle+pipeline overhead, mirroring the real
  numbers) cadences at ~2000ms average over 8s, not ~3500ms.
- 3 tabs sharing a 300ms setting: each tab's own cadence averages ~900ms (interval × 3);
  combined grant rate across all 3 averages ~300ms (1 per chosen interval); grant counts
  are balanced across tabs (no starvation).
- A tab that "closes" mid-run (stops requesting, exactly like a real tab close or logout)
  causes the remaining tab to speed back up to the full un-shared interval within one cycle
  — no lag, no stale N.
- A live slider change mid-session (2000ms → 500ms) is picked up by the very next pacing
  check, not the previously-cached value.
- 11/11 structural checks confirming the exact code changes are present in both files.

**NOT verified — needs manual browser testing (no browser available in this environment):**
1. **1 tab, real browser:** set the slider to 2s, open DevTools Network tab, confirm actual
   `/api/loadboard/search` requests are ~2s apart (not ~3.5s as previously reported).
2. **4 tabs, real browser:** set the slider to 2s in all 4, confirm the **combined** request
   rate across all 4 tabs (sum of requests/sec in the Network tab across tabs) is ~1 request
   per 2s total — i.e. each individual tab should visibly refresh roughly every ~8s
   (2s × 4), not more, not less.
3. Close (or log out) one of the 4 tabs mid-session and confirm the remaining 3 tabs speed
   up toward ~6s each (2s × 3) promptly, without a long lag.
4. Change the slider while multiple tabs are running and confirm the new pacing floor takes
   effect for ALL tabs within one tick, not just the tab that changed it.
5. Re-run TC-RATELIMIT-1's original 503 regression scenario (3-4 tabs, fast setting) to
   confirm the combined-rate protection still holds after this fix — this fix changes HOW
   the floor is computed but must not reopen the original bug.
6. Confirm 503 backoff (TC-RATELIMIT-1 steps 4-8, TC-RATELIMIT-2 step 5) is unaffected by
   this change — this fix only touches the pacing floor, not the backoff check, which still
   runs first and unconditionally in `grantOrDenyPermit()`.

### 2026-07-20 — Cross-tab rate limiting follow-up: make the shared budget OPTIONAL

**Ask:** the cross-tab permit system (previous entry below) must not be forced — add a
"Shared refresh limit" toggle (default ON) in the popup. ON = previous behavior (one
global request budget via `background.js`'s permit dispenser, 503 backoff). OFF = legacy
behavior: each tab fires its own refresh on its own schedule, no permit requests, no
cross-tab coordination — **except** 503 backoff, which is never optional and must still
pause a tab and show the countdown even in OFF mode.

**Wiring reported before coding (per instruction):** the refresh-interval slider was
already global (`STORAGE_KEYS.REFRESH_INTERVAL_MS`, cached in `content.js` as
`globalRefreshIntervalMs`, synced live via `chrome.storage.onChanged`).
`orchestratorTick()` unconditionally sent `{type:'REQUEST_PERMIT'}` before every
`refreshNow()` and skipped the tick if denied; `background.js`'s `grantOrDenyPermit()`
checked backoff first (deny if active), then paced against
`lastGrantedAt + GLOBAL_MIN_PERMIT_INTERVAL_MS`. Backoff itself is populated by
`content/networkObserver.js`'s MAIN-world 503 observation → `REPORT_RESULT`, entirely
independent of the pacing/permit path — this made backoff and pacing already separable
without a parallel implementation.

**Design decision (interpretive judgment call, flagged for review):** the refresh-interval
*value* stays a global setting regardless of the new toggle — only the PACING/COORDINATION
step (asking `background.js` for a permit before firing) is what toggles off. The tooltip
text says "give each tab its own **timer**", which reads as describing the coordination
mechanism, not the interval value's storage location; reverting the interval itself back to
per-tab (as it was before the whole rate-limiting feature) was judged out of scope and not
requested by requirement 5 ("Setting is global... and persists" — describing the NEW
toggle, not the interval). If this is wrong, say so and it's a small follow-up.

**Implementation:**
- `utils/storage.js`: new `STORAGE_KEYS.SHARED_LIMIT_ENABLED = 'sharedRefreshLimitEnabled'`, true-default.
- `background.js`: `grantOrDenyPermit(sharedLimitEnabled)` now checks backoff FIRST,
  unconditionally; only when backoff is clear does it branch — `sharedLimitEnabled === false`
  grants immediately (no pacing wait, `lastGrantedAt` left untouched so it never competes
  with a concurrently shared-mode tab's pacing math); `true` (or the flag missing, for
  backward safety) runs the existing pacing wait unchanged. `requestPermit()` threads the
  flag through the existing FIFO queue.
- `content/content.js`: caches `sharedRefreshLimitEnabled` (true-default), seeded +
  live-synced via `chrome.storage.onChanged` — identical pattern to
  `globalRefreshIntervalMs`. `orchestratorTick()` still sends `REQUEST_PERMIT` on every
  tick regardless of the setting (this is what keeps backoff working in both modes) but now
  includes `sharedLimitEnabled: sharedRefreshLimitEnabled` in the message so
  `background.js` knows whether to also enforce pacing.
- `content/sidebar.js`: **no changes.** The rate-limit banner (`updateRateLimitDisplay()`)
  already reads `RATE_LIMITER_KEY.backoffUntil` directly, independent of any mode, so it
  already shows the "Paused — Amazon rate limit" countdown correctly in both ON and OFF
  states without modification.
- `popup/popup.html` / `popup.css` / `popup.js`: new "Shared refresh limit" toggle row
  (`data-testid="popup-shared-limit"`) placed in the Display & Alerts section, right after
  Auto-Open Top Load, following the exact existing `.popup-row`/`.toggle-switch` markup and
  the `KEY_AUTO_OPEN` true-default read/write/reset/live-sync pattern. A circled "i" icon
  (`data-testid="popup-shared-limit-info"`) next to the label shows a tooltip
  (`data-testid="popup-shared-limit-tooltip"`) with the exact requested text, on hover AND
  keyboard focus (not a native `title` attribute — those don't reliably show on focus),
  matching `content/sidebar.js`'s existing memory-info tooltip pattern adapted to static
  HTML/CSS since no popup-side precedent existed.

**Verified (Node `vm` sandbox loading the real `background.js`, no browser available — see
Verification rules):** 15/15 checks — OFF-mode grants immediately with no pacing wait (2
back-to-back requests <500ms); ON-mode (and a request with the flag omitted entirely, for
backward safety) still enforces the ~5s pacing floor; backoff denies permits in BOTH
OFF and ON mode after a reported 503, and the denial carries `backoffUntil` for the
countdown; once backoff expires, OFF-mode grants immediately without any pacing wait;
a reported 200 fully resets backoff. Separately verified structurally (source-text
assertions, since these files are DOM-heavy) that popup.html/css/js and content.js contain
the toggle markup, tooltip markup with the exact requested copy, keyboard-focusability,
the true-default storage pattern, the live-sync listener, and that `orchestratorTick()`'s
`REQUEST_PERMIT` message now carries the flag.

**NOT verified — needs manual browser testing (no browser available in this environment):**
1. Visual check of the toggle row and "i" icon rendering/alignment in the actual 320px popup, both themes (Night Mode on/off).
2. Tooltip position/overflow — `left:0` positioning relative to the icon has not been visually confirmed to stay within the popup's bounds; may need a tweak if it clips at the edge.
3. Tooltip shows/hides correctly on real mouse hover and real Tab-key keyboard focus.
4. Toggling the switch in one tab's popup takes effect on another already-open Relay tab within one tick, with no reload — the `chrome.storage.onChanged` live-sync path is verified logically in isolation, not end-to-end.
5. With the toggle OFF and multiple real tabs open, confirm each tab fires its own refresh without waiting on another tab (no more 503-inducing burst was NOT re-tested here — this task only adds the ESCAPE HATCH; the original problem this whole feature solves will recur if a user intentionally turns it off with many tabs open, which is expected/accepted per the ask).
6. With the toggle OFF, force a real 503 (or simulate) and confirm the sidebar banner still shows "Paused — Amazon rate limit" with a live countdown, and that the tab actually pauses (does not keep firing) during that window.

### 2026-07-20 — Cross-tab rate limiting: one global request budget + backoff on 503

**Problem, confirmed with real data:** with 3-4 Relay tabs open, each running its own
independent 2s refresh timer, Amazon returned HTTP 503 on
`https://relay.amazon.com/api/loadboard/search` for ALL tabs simultaneously. Switching
networks restored access immediately, confirming the throttle is IP-based, not
account-based. Root cause: the refresh interval was PER TAB (`utils/tabState.js`), so N
open tabs multiplied the effective request rate against one IP.

Files changed: `manifest.json`, `utils/storage.js`, `utils/tabState.js`,
`content/sidebar.js`, `content/content.js`. New files: `background.js` (this extension's
first-ever service worker), `content/networkObserver.js`.

**Current slider wiring, reported before changing it (per instruction):**
`content/sidebar.js`'s `ext-slider-speed` wrote `tabState.set('refreshIntervalMs', sec *
1000)` on `input` — per-tab, sessionStorage-backed (`ext_tab_speed`), fully isolated
between tabs by the file's own design ("Per-tab state store — isolates running,
refreshIntervalMs, surgeThreshold, priceHistory"). `content/content.js`'s
`scheduleNextTick()` read `tabState.get('refreshIntervalMs')` to pace that tab's own timer,
completely independent of every other open tab.

**1. Permit dispenser (`background.js`, new).** `chrome.runtime.onMessage` handles
`REQUEST_PERMIT` (grants/denies, enforcing one global minimum interval across all tabs) and
`REPORT_RESULT` (advances/resets backoff). **Design constraint honored exactly as
specified: this file never performs the board fetch itself** — it only coordinates via
`chrome.storage.local`; the fetch/click stays entirely in the content script, which needs
the page's own auth context. Concurrent requests are serialized through an in-memory
promise chain (`permitQueueTail`) — FIFO, so no tab can cut the line ("round robin, no tab
starves"). **Critically, this chain is NOT the source of truth**: MV3 service workers are
not persistent (Chrome can terminate one after ~30s of no pending activity and restart it
fresh), so every grant/deny decision re-reads `chrome.storage.local` on each call; if the
worker is evicted and restarted between requests, the in-memory chain just resets to a
no-op with zero correctness impact, because pacing is governed by the persisted
`lastGrantedAt` timestamp, never by anything held only in memory. `content/content.js`'s
`orchestratorTick()` requests a permit before every `refreshNow()` call and skips the
refresh entirely (no fetch, no pipeline run) when denied — the next scheduled tick asks
again, which also means the worker keeps receiving messages throughout a backoff period
instead of being evicted for the full 5-minute worst case.

**Named constant, empirical and unverified, as instructed:**
```js
// EMPIRICAL, UNVERIFIED — Amazon's real per-IP rate threshold for /api/loadboard/search is
// NOT known. This is a conservative guess based on exactly one observed failure...
const GLOBAL_MIN_PERMIT_INTERVAL_MS = 5000;
```
Chosen as roughly 10x below the observed failure rate (4 tabs × 1 req/2s ≈ 2 req/s
aggregate caused sustained 503s) — a guess at a safe margin, not a confirmed safe rate.
Adjustable in exactly one place if real capacity data ever emerges.

**2. Refresh interval is now GLOBAL.** `STORAGE_KEYS.REFRESH_INTERVAL_MS =
'globalRefreshIntervalMs'` added (a new key, not a reuse of the legacy `SPEED` key — different
unit, different semantics). `utils/tabState.js`'s `refreshIntervalMs` field removed entirely
(was one of 4 per-tab fields; now 2). `content/sidebar.js`'s slider reads/writes
`chrome.storage.local` directly instead of `tabState`, with a `chrome.storage.onChanged`
listener so every open tab's slider stays in sync live when changed from any one of them.
Label/tooltip updated: `title="Refresh speed — applies to ALL open Relay tabs, not just this
one"` on both the slider and its value display, per the instruction to make the new scope
explicit in the UI.

**3. Backoff on failure.** `content/networkObserver.js` (new) — injected as a **separate**
`"world":"MAIN"` content_scripts entry in `manifest.json` (Chrome 111+ declarative
main-world injection; every other file in this extension runs isolated). This is required
specifically to see Amazon's own `fetch()`/`XMLHttpRequest` calls, which use the page's own
`window.fetch` reference, invisible to an isolated-world script. **Read-only observation
only** — wraps fetch/XHR to watch responses; never modifies a request, never delays one,
never invents a new one. Only requests whose URL contains the confirmed
`/api/loadboard/search` path are reported (via `window.postMessage`, the standard
MAIN↔ISOLATED world technique) to `content/content.js`, which relays `{ ok, status }` to
`background.js` via `REPORT_RESULT`. Backoff schedule exactly as specified: `[5000, 10000,
20000, 40000, 80000]` ms, capped at `300000` (5 min), ±20% jitter
(`Math.random() * 2 - 1) * ratio`), advancing one step per consecutive failure, reset to
"normal" only by a reported 2xx. **5xx/network-failure only** — a 401/403 does not trigger
backoff (that is an auth problem, not a rate problem; treating it as "the whole browser
must back off" would be wrong).

**4. Visible state.** New `ext-rate-limit-banner` element in `content/sidebar.js`: while
`backoffUntil` is in the future, it replaces `ext-playpause`/`ext-slider-speed`/
`ext-slider-value` in place (not a separate row — the sidebar is only 40px tall) with
"Paused — Amazon rate limit. Retrying in Xs", updated every second via a local
`setInterval` (does **not** re-message the service worker every second — `backoffUntil` is
a fixed timestamp cached locally and refreshed live via `chrome.storage.onChanged`, so the
countdown is purely a local re-render). Fixed amber color (`#d4a72c`, the same tier already
used for the memory indicator's amber state) rather than a `--ext-*` token, for the same
reason the Fast Book button uses a fixed color — a semantic caution signal that must read
consistently regardless of theme.

**5. One shared state, not per-tab backoff.** All backoff state lives in
`chrome.storage.local` under `RATE_LIMITER_KEY`, owned exclusively by `background.js` — no
tab computes or stores its own backoff; every tab reads the same value and shows the same
countdown.

**6. Persistence.** `chrome.storage.local` (not `chrome.storage.session`, not any in-memory
JS state) is the sole source of truth for both `RATE_LIMITER_KEY` and
`REFRESH_INTERVAL_MS` — a popup reopen, a tab reload, or a service-worker restart all read
the same persisted state fresh; nothing resets on any of those events. `RATE_LIMITER_KEY`
was deliberately kept **out of** `STORAGE_KEYS` (same reasoning as `SUPABASE_SESSION_KEY`/
`AUTH_PENDING_KEY`) — "Reset to Defaults" clearing live coordination state mid-backoff
would let every tab immediately hammer Amazon again right when the extension is most likely
to be freshly reset after trouble. `REFRESH_INTERVAL_MS` **is** in `STORAGE_KEYS` — it is a
genuine user preference, correctly reset like every other slider/toggle.

**Verified — real functional tests, not just structural checks (no browser needed for
this part; `background.js` has zero DOM dependency):** ran the actual `background.js` in a
Node `vm` context with `chrome.storage.local` mocked as a real async in-memory store and
`chrome.runtime.onMessage` driven directly. 18/18 checks passed, including: two requests
5000ms apart are correctly spaced ~5000ms (not both granted immediately); three concurrent
"tabs" requesting at once are serialized FIFO over ~2x the interval (not all granted at
once, not starved); a reported failure produces a backoff duration within the 5s ±20%
jitter band; six consecutive failures advance the backoff index exactly 0→1→2→3→4→5(capped);
a success resets the index to -1 and clears `backoffUntil`; and — critically — **a
freshly-constructed worker instance reading the same persisted store still correctly denies
a permit**, directly verifying backoff survives a simulated service-worker restart. Also
ran a separate integration test against `content/content.js`'s `orchestratorTick()`: 4/4
checks confirm `refreshNow()` is never called when a permit is denied or when the permit
request itself fails (fail-safe), and is called normally when granted.

**Could NOT be verified (explicitly, per Verification rules) — no browser available in
this environment:**
- The `networkObserver.js` fetch/XHR patching actually intercepting real page traffic —
  Node has no `XMLHttpRequest` global at all, and testing `fetch` patching in Node would
  not reflect real page behavior regardless.
- The sidebar banner's actual visual rendering/layout (same limitation as every CSS change
  this session).
- Real `chrome.runtime` message-passing timing/serialization between the actual separate
  service-worker and content-script processes (the functional test above runs everything
  in one process/context — real IPC has its own behavior).
- Whether a manifest `content_scripts` entry with `"world":"MAIN"` behaves as expected in
  the dispatcher's actual Chrome version (a Chrome 111+ feature).
- Real service-worker eviction/restart behavior over the true multi-minute backoff window
  in an actual browser session, with actual multiple tabs.

**What still needs manual browser testing, explicitly, as instructed:**
1. Open 4 Relay tabs, log in, start the loop in all four. Confirm — via the Network tab or
   `chrome://serviceworker-internals`/`chrome://inspect` on the service worker's console —
   that the aggregate request rate across ALL FOUR tabs together matches
   `GLOBAL_MIN_PERMIT_INTERVAL_MS` (one board request roughly every 5s total, not four
   tabs each independently hitting every ~2s).
2. Force a 503 (or simulate one — e.g., temporarily block `/api/loadboard/search` via
   DevTools request blocking in one tab) and confirm: all four tabs' sidebars switch to
   the "Paused — Amazon rate limit. Retrying in Xs" banner at the same time, the countdown
   ticks down in sync across tabs, and normal operation resumes in all tabs together once
   backoff ends (or a real 200 is observed).
3. Reopen the popup and reload a tab mid-backoff — confirm the countdown does not reset
   (persistence).
4. Confirm the global slider change in one tab is reflected live in every other open tab.

**Not implemented, flagged for follow-up:** `docs/SAFETY.md` was not updated this pass
(not in this task's requested doc list), but this change introduces two genuinely new kinds
of surface this project has not had before — a background service worker, and a MAIN-world
script that patches `window.fetch`/`XMLHttpRequest.prototype` — that this codebase's usual
rigor around documenting click sites and network writes would normally cover. Worth a
SAFETY.md pass separately.

### 2026-07-20 — CSS polish: segment header route grouping, table header/cell styling, zebra striping

Files changed: `content/inlinePanel.js` (JS + CSS), `content/nightMode.js` (CSS). Layout
width untouched — `display:table !important;width:100% !important` on
`.ext-inline-panel__table` (previous fix) is unchanged.

**Quoted current-state before changing anything, as instructed** — `.ext-seg-header`'s
`grid-template-columns` was `40px minmax(0,3fr) 1.4fr 1fr 1fr 32px`; `th` was
`text-align:left;font-size:11px;color:var(--ext-n500);font-weight:bold;padding:10px
14px;background:var(--ext-n100);vertical-align:middle;border-bottom:1px solid
var(--ext-n200);`; `td` was `padding:10px 14px;border-bottom:1px solid
var(--ext-n200);vertical-align:top;word-break:break-word;` plus a `border-right` column
separator added in the immediately preceding pass.

**1. Segment header route grouping.** The origin badge and its station code were genuinely
in two separate DOM elements/grid columns (`.ext-seg-title` holding only the badge,
`.ext-seg-route` holding origin/arrow/dest) — CSS alone cannot merge two sibling grid items
into one flex cell, so this required a small structural change in `buildPanelElement()`:
`.ext-seg-title` was removed; the origin badge, origin code, arrow, destination badge, and
destination code are now five flat children appended directly to `.ext-seg-route`, which is
now `display:flex;align-items:center;gap:6px;flex:0 1 auto` (content-sized, not a fixed
grid fraction). `.ext-seg-header` itself switched from CSS Grid to `display:flex;gap:8px`.
The remaining columns (distance/duration, load type, status, chevron) are pushed into a
compact right-aligned cluster via `margin-left:auto` on `.ext-seg-dist` (the first of that
group), which consumes all free space between it and the route group — a standard flexbox
idiom, no extra spacer element needed. Header text: `font-weight:600`, `color:var(--ext-n900)`
(darker than the table body's `var(--ext-n700)` primary line, per instruction).

**2. Table header row (`th`).** `font-size:10px` (was 11px), `text-transform:uppercase`,
`letter-spacing:0.4px`, `font-weight:600` (was `bold`), `padding:6px 12px` (was `10px 14px`
— "currently too tall"). Background unchanged (`var(--ext-n100)` was already correctly "one
step darker than data rows").

**3. Data cells (`td`).** Primary line (station code/city — the `<b>` element built in
`buildSegmentTable()`, no class of its own) styled via a new tag selector
`.ext-inline-panel__table td b{font-weight:600;color:var(--ext-n700);font-size:13px;}` —
chose a scoped tag selector over adding a class in JS, since the element is unambiguous
within this table and it kept `buildSegmentTable()` untouched. Secondary line
(`.ext-stop-addr`): `font-size:11px` (was 12px), `margin-top:2px` added. Cell padding
`8px 12px` (was `10px 14px`), `vertical-align:middle` (was `top`). **Column-separator
borders removed** (`border-right` rule from the previous pass deleted) — "keep only
horizontal separators", per this instruction; `border-bottom:1px solid var(--ext-n200)`
kept as the sole row separator.

**4. Column widths.** 40/20/20/20 → **Stop 34%, Equipment/Id 18%, Arrival 24%, Departure
24%** (both `th` and `td` `nth-child` rules updated).

**5. Zebra striping.** `.ext-inline-panel__table tbody tr:nth-child(even) td{background:
var(--ext-n100);}` — reuses the same subtle tint already used for the header rather than
inventing a new shade ("existing CSS custom properties only"). **Dark-mode counterpart
added to `content/nightMode.js`**, not just left to the universal override: the existing
`#ext-inline-panel tbody td{background-color:DK_HIGH !important}` rule would otherwise
blanket-erase the zebra tint in Night Mode (same `!important`, but a plain `tbody td` loses
to a more specific `tbody tr:nth-child(even) td`, so a matching rule was needed, not just
inherited "for free" like the border-color fixes in the previous two passes). Added
`html.ext-night #ext-inline-panel tbody tr:nth-child(even) td{background-color:DK_OVERLAY
!important;}` — reuses `DK_OVERLAY` (already the panel's own background color in dark mode),
not a new color.

**Verified (structural + DOM-shape only — still explicitly not a rendered-layout proof, no
browser available in this environment):** loaded the real `injectPanelStyle()` and
`buildPanelElement()` in a Node `vm` context with a minimal fake DOM. 27 checks, all passing:
every intended CSS declaration is present verbatim (flex conversion, `margin-left:auto`,
th/td font-size/padding/transform, column-border removal, `34/18/24/24` widths, zebra rule,
updated `.ext-stop-num` selector), the removed `.ext-seg-title` rule is gone, and — critically
— `buildPanelElement()`'s actual output DOM was inspected directly: `.ext-seg-header` now has
exactly 5 children (was 6), and `.ext-seg-route` now has exactly 5 flat children in the
correct order (badge, origin code, arrow, badge, destination code), confirming the
route-group merge actually happened in the generated markup, not just in the CSS.

**Still needs manual browser confirmation** — nothing above proves the visual result. Check,
in both light mode and Night Mode, for a multi-segment load: the badge+code+arrow+badge+code
now read as one visually grouped cluster at the left (not drifting apart); the
dist/duration+load-type+status+chevron cluster sits compactly at the right; the header row
looks smaller/uppercase/darker-text than before; data cells show only horizontal separators
(no vertical noise); even rows show a subtle tint distinguishable from odd rows in both
modes; and the primary/secondary stop-line text sizes read as intended. See
docs/TEST_CASES.md TC-PANEL-POLISH-1.

**Note:** `docs/UI_ELEMENTS.md`'s Inline Panel section (updated two passes ago) now has some
stale claims — "Always 6 child spans" for `.ext-seg-header`, and the column-separator/padding
description — not updated this pass since it wasn't in this task's requested doc list
(CHANGELOG.md, TEST_CASES.md only). Flagging so it isn't silently wrong if referenced later.

### 2026-07-20 — FIX: inline panel table width — real root cause (Amazon's global `table{display:block}` rule)

Files changed: `content/inlinePanel.js` (CSS only, `injectPanelStyle()`).

Supersedes the previous same-day width fix, which was insufficient — the segment table
still rendered at ~40-45% of the card width afterward. **Root cause this time was found by
live browser measurement, not hypothesis**: `.ext-inline-panel__table` computed to
`display:block`, because Amazon has a global page rule setting `<table>` to
`display:block`. A block-level table ignores `width:100%` for its own internal layout — the
browser builds an anonymous shrink-to-fit table box inside the block instead — which is
exactly why the table always rendered narrow with empty space on the right, regardless of
`width:100%` being present. Confirmed live: forcing `display:table !important;width:100%
!important` on the element immediately spanned the full card width, while an untouched
sibling table stayed narrow.

Fix:
```
.ext-inline-panel__table{display:table !important;width:100% !important;table-layout:fixed;border-collapse:collapse;}
```
A code comment is included directly above this rule explaining `!important` is required
specifically to beat Amazon's global `table` rule, and warning not to remove it as a
"cleanup."

**Checked whether any other injected table has the same problem** (per instruction): grepped
the entire codebase for `createElement('table')` / `<table` — `content/inlinePanel.js` is the
**only** place in the extension that creates a `<table>` element. `content/patModal.js` (PAT
modal — origin/dest/times/miles/payout rows) and `content/sidebar.js` (play/pause, speed
slider, memory indicator) both lay their content out with CSS grid/flex on `<div>`s, never
`<table>`. **No other fix needed or made.**

Column-width percentages (40/20/20/20, Stop widest) are unchanged, per instruction — this
fix only touches `display`/`width` on the table element itself, not its columns.

**Verified (structural only — still not a rendered-layout proof):** no browser available in
this environment (unchanged from the last two entries). Loaded the real `injectPanelStyle()`
in a Node `vm` context and confirmed the generated CSS is brace-balanced and contains the
exact new declaration (`display:table !important`, `width:100% !important`,
`table-layout:fixed`, `border-collapse:collapse`) verbatim, with the previous fix's changes
(panel `width:100%`, column-separator borders, unified padding, header background) and the
40/20/20/20 column widths all still intact.

**Still needs manual browser confirmation** — the user's own live measurement identified
this root cause and confirmed the fix works on one table via direct DOM manipulation in
DevTools; what's not yet confirmed is the *shipped* `injectPanelStyle()` rule doing the same
across all four required scenarios: single-segment light mode, single-segment Night Mode,
multi-segment light mode, multi-segment Night Mode. See docs/TEST_CASES.md
TC-PANEL-WIDTH-2 for the exact before/after measurement steps.

### 2026-07-20 — FIX: inline panel segment tables collapsed to ~half width, left-aligned

Files changed: `content/inlinePanel.js` (CSS only, inside `injectPanelStyle()` — no
data/field/structural changes, per the task's scope).

**Investigation (read-only, done first):** `git log`/`git diff` on every file that renders
or styles this panel (`content/inlinePanel.js`, `utils/designTokens.js`,
`content/nightMode.js`, `content/highlighter.js`, `content/priceSurge.js`) found **no code
regression** — the panel's core CSS and structure were byte-identical back to the last
several commits; only additive, unrelated changes (Fast Book, login gating) had landed. Two
explicit hypotheses (a `clearPipelineDom()`/`showInlinePanel()` race; light-mode CSS leakage
from `nightMode.js`) were both ruled out with direct code evidence. **Root cause identified
by inspecting the actual CSS**, not the diff: `.ext-inline-panel` (the panel's outer
container, inserted as a sibling of the load card via
`cardElement.parentNode.insertBefore(...)`) had no explicit `width`. `.ext-inline-panel__table`
itself already had `width:100%;table-layout:fixed` with proportional column widths (40/20/20/20%)
— correct, and unchanged by this fix — but a plain block `<div>` with no explicit width
shrinks to its content's natural size instead of filling the row when its parent context
lays children out via flex/grid, which is consistent with Amazon's load-list container. This
existed for some time; it likely only became visually jarring recently because — per the
task description — Amazon added visible borders to its own detail tables, and the
now-narrower/borderless contrast made ours look obviously wrong next to them.

Fix:
- `.ext-inline-panel{ width:100%; box-sizing:border-box; ... }` — the core fix. `box-sizing:
  border-box` keeps the existing 1px border from pushing the rendered width past the card's
  width now that `width:100%` is explicit.
- Column-separator borders added: `.ext-inline-panel__table th:not(:last-child), td:not(:last-child)
  { border-right: 1px solid var(--ext-n200); }` — previously only row separators
  (`border-bottom`) existed; Amazon's own tables now show both row and column separators.
- Cell padding unified: `th` was `8px 14px`, `td` was `10px 14px` — both now `10px 14px`.
- Border color unified: `td`'s `border-bottom` was `var(--ext-n200)` for `th` but
  `var(--ext-n100)` (a lighter shade) for `td` — both now `var(--ext-n200)`, "same color
  family" end to end.
- Header visually distinct: `th` gained `background:var(--ext-n100)` (previously no
  background at all — only text color/weight differed) and explicit `vertical-align:middle`
  (parity with `td`'s existing `vertical-align:top`).
- All new colors use `var(--ext-n200)`/`var(--ext-n100)` (CSS custom properties from
  `utils/designTokens.js`), never a hardcoded hex — confirmed via `content/nightMode.js`'s
  existing universal `html.ext-night body *:not(...){ border-color: <dark border> !important;
  background-color:transparent !important; ... }` rule (plus its existing, more specific
  `#ext-inline-panel thead th`/`tbody td`/`tbody tr` overrides) that every new rule added here
  is automatically corrected for dark mode — **no changes to `content/nightMode.js` were
  needed or made.**

**Column proportions** (Stop widest, then Equipment/Id/Arrival/Departure roughly equal) were
**already correct** in the existing code (40/20/20/20% via `table-layout:fixed`) — not
changed by this fix, since the visual "collapse" was the outer container's width, not the
table's internal proportions.

**Verified (structural only — explicitly NOT a rendered-layout proof):** no browser,
jsdom, or CSS parser is available in this environment (checked: `playwright`, `puppeteer`,
`jsdom` all absent; no Chromium/Edge binary on `PATH`). Loaded the real `injectPanelStyle()`
in a Node `vm` context and captured its generated CSS string — confirmed brace-balanced
(40/40), confirmed every intended change is present verbatim (width:100%, box-sizing,
unified padding, header background, unified border color, the new column-separator rule),
and confirmed the untouched parts (table width/layout, 40/20/20/20 column widths) survived
unchanged. **This proves the CSS text is well-formed, not that it renders correctly.**

**Still needs manual browser testing (explicitly, per Verification rules) — nothing here has
been visually confirmed:**
1. Open a load's inline panel (single-segment and multi-segment) on the real load board and
   confirm the segment table now spans the full card width, not ~half/left-collapsed.
2. Confirm column-separator borders render as 1px lines, matching Amazon's own current
   bordered-table look (color/weight) side by side.
3. Confirm the header row reads as visually distinct (subtle background) without looking
   out of place next to Amazon's own header styling.
4. Repeat in Night Mode — confirm no light-mode colors leak through and the panel still
   reads correctly against the dark surface.
5. Item 2 of this task ("inspect Amazon's own detail table widths/borders/padding") could
   **not** be done — no live page access in this environment. The fix targets the reported
   symptom (full-width table, visible column separators, consistent padding) using values
   already established elsewhere in this same file/design system, not measured Amazon
   values. A dispatcher should eyeball this side-by-side against Amazon's current table and
   flag if the border color/weight or padding needs tuning to match more closely.

**Six-item smoke checklist (docs/CLAUDE.md Verification rules) — not run, no browser
available:** (a) popup opens without console errors — not run; (b) logged-out popup shows
only the login block — not run; (c) full login flow works — not run; (d) sidebar/panel
activates on the load board — not run; (e) PAT modal opens and Confirm enables with valid
data — not run; (f) no errors in the page console — not run. This change is CSS-only inside
an existing, already-gated render path, so risk to (a)/(b)/(c)/(e)/(f) is low, but "low risk"
is not the same as "verified" — flagging per the rule rather than implying any of these were
checked.

**Read-only finding, not implemented (explicitly out of scope for this task) — data fields
present in a competitor's accordion but missing or incomplete in ours:**
- **Per-segment payout** — `segment.price` is hardcoded to `''` in `readSheetData()`
  (`content/inlinePanel.js`), never populated from the DOM, never rendered.
- **Segment ID label** — `segment.idLabel` is likewise hardcoded to `''`, never populated
  or rendered (stop-number circles are shown instead of a distinct segment identifier).
- **Stop-level warnings** (e.g. Road Restriction) — no field exists at all in
  `parseStopBlock()`'s returned stop object; zero handling anywhere in the file.
- **Segment distance/duration** — partially present: `segment.miles`/`segment.duration`
  *are* extracted and rendered, but **only** in the multi-segment collapsible header
  (`ext-seg-dist`) — for single-segment loads (`buildPanelElement()`'s `else` branch), these
  same computed values are silently discarded and never shown at all.

### 2026-07-20 — FIX: in-flight detection tick no longer outlives a logout

Files changed: `content/content.js`.

From the read-only logic audit: `runDetectionPipeline` (spans `await checkPriceSurge`,
`await playAlert`, `await storage.get`, `await sleep(800)`) and `orchestratorTick` (spans
`await sleep(REFRESH_SETTLE_MS)`) never re-checked the login gate or `tabState.get('running')`
after entry. Since logout became live (no reload needed — see the 2026-07-20 TASK 1 entry
below), a logout landing mid-tick let the in-flight tick finish anyway: it could still
highlight cards, play sound, auto-open a card, and call `showInlinePanel()` — creating a
fresh `#ext-inline-panel` — **after** `deactivateExtensionUI()` had already torn everything
down.

Fix:

- New `shouldContinue()` — the single shared helper requested, checking both
  `isAuthGateActiveSync()` (login gate) and `tabState.get('running')`. Used at every
  checkpoint below instead of duplicating the condition.
- A checkpoint was added after **every** `await` inside `runDetectionPipeline` (after
  `checkPriceSurge`, after `playAlert`, after each `storage.get(AUTO_OPEN)` read in both the
  new-loads and surge branches, after each `sleep(800)` settle in both branches — the exact
  spot the bug report identifies, right before `showInlinePanel()`) and inside
  `orchestratorTick` (after `sleep(REFRESH_SETTLE_MS)`, before calling
  `runDetectionPipeline`). Each bails out (`return`, no further side effects) the moment
  `shouldContinue()` is false.
- New `clearPipelineDom()` — wipes `removeInlinePanel()` + `clearHighlights()` +
  `clearSurgeHighlights()`. Called both by every bail-out checkpoint above **and** by
  `deactivateExtensionUI()` (replacing its three separate calls). This is what makes
  deactivate authoritative per instruction 3: `checkPriceSurge()` applies surge highlights
  *internally*, synchronously, before its own awaited `playAlert()` resolves — i.e. before
  `runDetectionPipeline`'s very first checkpoint even runs — so a bail-out there could
  otherwise leave a surge highlight/badge behind. Every function `clearPipelineDom()` calls
  is already a no-op when there's nothing to clear, so it's safe to call unconditionally at
  every checkpoint regardless of whether that particular checkpoint's gap actually left
  anything behind.
- `runDetectionPipeline` is shared by both `orchestratorTick` (tick path) and
  `runObserverPipeline` (loadObserver.js, MutationObserver path) — adding the checkpoints
  inside the shared function protects both callers without touching `loadObserver.js`.

**Verified** (no browser needed — pure async-timing logic, not DOM-rendering-dependent):
loaded the real `content/content.js` in a Node `vm` context with `tabState`/
`isAuthGateActiveSync`/`checkPriceSurge`/`openTopNewLoad`/`showInlinePanel`/etc. stubbed, and
ran the exact bug scenario — called `runDetectionPipeline('tick')`, let it reach the 800ms
settle wait (past `checkPriceSurge`, `highlightNewLoads`, `playAlert`, and a successful
`openTopNewLoad`), then flipped the auth gate closed partway through that wait, simulating a
logout landing mid-tick. Confirmed: `showInlinePanel` is **not** called, while
`removeInlinePanel`/`clearHighlights`/`clearSurgeHighlights` all fire from the bail-out.
Also confirmed: the normal case (gate stays active) is completely unaffected —
`showInlinePanel` still fires exactly as before; a gate already closed *before* the tick
starts bails at the very first checkpoint (no highlighting at all); and `tabState.get('running')`
flipping false (a sidebar pause, not just a logout) triggers the same bail-out, since
`shouldContinue()` checks both conditions.

**Still needs manual browser testing** (not exercised here — this only proves the
async-control-flow logic, not real DOM/timing behavior in a live tab): log in, start the
loop on a real Relay tab, and log out via the popup at a moment timed to land mid-tick
(the ~1.2s refresh-settle window or the ~800ms post-open-settle window are the two
realistic targets). Confirm nothing appears afterwards — no inline panel, no highlighted
cards, no surge badge — and that this holds up across several repeated attempts, since the
exact timing window is hard to land deliberately by hand. See docs/TEST_CASES.md.

No other finding from the audit was touched.

### 2026-07-20 — FIX: PAT modal no longer fabricates a load's start/end time

Files changed: `content/patModal.js`.

From the read-only logic audit: when `parsePatStopTime()` returned `null` (missing or
unrecognized-format arrival time — distinct from the already-handled `tzError` case),
`startTimeResult`/`endTimeResult` were silently replaced with `fallbackTime(1)` /
`fallbackTime(4)` — i.e. "now +1h" / "now +4h" — with no warning, and Confirm stayed enabled.
This posted a fabricated availability window unrelated to the load's real pickup/delivery
time, with no operator awareness. Applied the same no-silent-fallback rule already used for
Payout:

- `fallbackTime()` removed entirely — a missing/unparseable time is no longer given any
  default value.
- `makeTimeStepper()` now accepts `timeResult === null`: renders "Not set — click to enter"
  in place of a time, disables the ±15min step buttons (nothing to step from), and shows the
  manual-entry `datetime-local` input immediately (previously hidden behind a click) since
  there's nothing to display yet. The normal (non-null) path is unchanged — same collapsed
  display, same step behavior.
- New `ext-pat-times-warning` element under the time-steppers row: "Load times could not be
  read — enter start/end time manually". Shown/hidden live by `timesValid()` (new — checks
  `startStepper.getDate() && endStepper.getDate()`), wired into `updateConfirmEnabled()`
  alongside the existing payout/city checks.
- Confirm is gated on `timesValid()` **live**, not via the static `blockingErrors` array —
  unlike `loadingType`/`tzError` (permanent for the modal instance, left as instructed), a
  missing time is recoverable: `makeTimeStepper()` gained an optional `onChange` callback,
  fired on every stepper interaction, wired to `updateConfirmEnabled()` from both time
  steppers' construction call sites. The dispatcher can type both times manually and Confirm
  re-enables once every other condition is also met.
- Confirm-click handler gained the same redundant safety-net check already used for the
  other fields: `if (!startStepper.getDate() || !endStepper.getDate()) { ...; return; }`.
- tzError handling itself is unchanged (still its own specific "Unrecognized timezone: «X»"
  message, still permanently blocking) — removing the shared `fallbackTime()` means a
  tzError-nulled time now also renders as "Not set" instead of a fabricated time, which is a
  side effect of removing the fallback, not a change to tzError detection/messaging.

**Verified** (no browser needed — this is DOM-structure logic, not page-dependent): loaded
the real `content/patModal.js` in a Node `vm` context with a minimal hand-rolled fake DOM
element (`createElement`/`setAttribute`/`style`/`addEventListener`/`appendChild`/`value`/
`disabled` — no jsdom available in this environment) and exercised `makeTimeStepper()`
directly. 15/15 checks passed: a `null` input never fabricates a date and doesn't throw;
the empty-state label and disabled step buttons render correctly; stepping while empty is a
no-op; manually entering a datetime-local value correctly sets the date, fires `onChange`
exactly once, and collapses the input back to the normal display; and — critically — the
**normal (real time present) path is provably unaffected**: same immediate correct date,
enabled step buttons, and default-collapsed input as before this change.

**Still needs manual browser testing** (not exercised here): the full modal integration —
does `ext-pat-times-warning` actually render with correct placement/styling in the live PAT
modal; does `ext-pat-confirm` genuinely stay disabled/re-enable in the real DOM once a real
load with a missing/malformed arrival time is opened; does typing into the real
`datetime-local` picker (not a simulated `change` event) behave the same as the simulated
one; and interaction timing between `timesValid()`, `currentPayoutValid()`, and the async
city-resolution completion. See docs/TEST_CASES.md for the exact steps.

No other finding from the audit was touched.

### 2026-07-20 — FIX: resolvePATCity crash on empty city (undefined `boardStopStr`)

Files changed: `content/patApi.js`.

From the read-only logic audit: `resolvePATCity()`'s empty-city guard logged
`{ boardStopStr: boardStopStr }` — `boardStopStr` was never declared anywhere in the
function (the parameter is `input`), and this line sat **before** the function's own `try`
block starts. Any city that parsed down to an empty string (reachable — the function already
has three layered fallback strategies for messy board text, implying this happens in
practice) threw an uncaught `ReferenceError` at that point. Since `patModal.js` calls this via
`Promise.all([resolvePATCity(origin), resolvePATCity(dest)])`, one rejected promise failed the
whole `Promise.all` — discarding a sibling city that may have resolved successfully — and
replaced the specific "Could not resolve city: «X, ST»" message with the generic "City
resolution error — check logger output" from `patModal.js`'s outer catch.

Fix: the log call now references `input` (the real parameter), and the empty-city check was
moved from before the `try` block to just inside it, so a failure in the logging call itself
(however unlikely) can no longer break city resolution — it falls through to the function's
existing `catch (e) { logger.error(...); return null; }` instead of propagating uncaught.

**Verified** (no browser needed — this is pure JS logic, not DOM-dependent): loaded the real
`content/patApi.js` in a Node `vm` context with `fetch`/`document` stubbed, and ran the exact
scenario from the audit — `Promise.all([resolvePATCity('') /* empty city */,
resolvePATCity({ city: 'MEMPHIS', state: 'TN' }) /* sibling */])`. Confirmed: no throw;
`resolvePATCity('')` resolves to `null` with exactly one `logger.error` call carrying
`{ input: '' }`; the sibling still resolves to a full match object (`displayValue: 'MEMPHIS, TN'`)
— it is no longer discarded. Traced (not executed — no browser) through `patModal.js`'s
unmodified `cityErrors` branch to confirm this now surfaces the specific "Could not resolve
city: «X, ST»" message instead of the generic fallback; this specific downstream
rendering was not exercised in an actual popup/modal, per docs/CLAUDE.md's Verification
rules — see docs/TEST_CASES.md for the manual browser check still needed.

No other finding from the audit was touched.

### 2026-07-20 — TASK 2: Verification rules added to docs/CLAUDE.md

New "Verification rules" section (between "Code rules" and "Communication"):
1. **PROOF BEFORE REPORT** — never report "done" for a UI-affecting change without
   actually exercising the flow; if the environment can't exercise it, say so explicitly
   and list exactly what the user must test, never imply verification happened.
2. **SMOKE CHECKLIST** — six items to run and report pass/fail on after any UI-affecting
   change: (a) popup opens without console errors, (b) logged-out popup shows only the
   login block, (c) full login flow works, (d) sidebar/panel activates on the load board,
   (e) PAT modal opens and Confirm enables with valid data, (f) no errors in the page
   console.

Applying rule 1 to this very session: this working environment has no browser, so none of
TASK 1 below has been exercised — see its entry for the explicit "what the user must test"
list, and STATE.md for the standing limitation.

### 2026-07-20 — TASK 1: activate/deactivate extension features on login/logout, no reload

Files changed: `utils/tabState.js`, `utils/authGate.js`, `content/content.js`,
`content/sidebar.js`, `content/inlinePanel.js`, `content/nightMode.js`,
`content/filterSimilar.js`, `content/filterTags.js`.

Previously the login gate (`utils/authGate.js`, added 2026-07-17/2026-07-20) was only
evaluated at content-script startup and at the sidebar's play/pause toggle — logging in or
out via the popup while a Relay tab was already open had no effect until that tab was
reloaded (explicitly called out as a known limitation in the last several entries). Fixed
via the storage-listener approach (preferred over `chrome.tabs.sendMessage` broadcast — no
tab enumeration needed, and it's the same mechanism `popup.js` already uses to write the
session).

**`utils/authGate.js`** — `_handleGateResult()` now runs every `getAuthGate()`/
`recheckAuthGate()` result through a transition check (`wasActive !== gate.active`) and
fires newly-added `onAuthGateChange(callback)` listeners only on an actual active↔inactive
flip — not on every session write (a silent mid-session token refresh keeps the gate active
throughout and must not re-fire "activate"). New `chrome.storage.onChanged` listener in this
file watches `SUPABASE_SESSION_KEY` and calls `recheckAuthGate()` on any write — this is what
detects a login/logout that happened via the popup while this tab's content script is
already running. New `isAuthGateActiveSync()` — a synchronous last-known-state read for call
sites that can't await (a live click handler).

**`content/content.js`** — startup logic split into `activateExtensionUI()` (idempotent:
`tabState.init()` + `buildSidebar()` + `initManualToggle()`) and `deactivateExtensionUI()`
(idempotent: stops the loop via `tabState.set('running', false)`, `removeInlinePanel()`,
`clearHighlights()`, `clearSurgeHighlights()`, unsubscribes the sidebar's tabState listener
and clears its memory-poll interval, then removes `#ext-sidebar` from the DOM entirely).
Both registered with `onAuthGateChange()`, so a live login instantiates the sidebar/inline
panel/loop exactly as if the page had loaded already logged in, and a live logout tears
everything back down to the same untouched state as content-script startup gating.

**`utils/tabState.js`** — added `unsubscribe(key, fn)`. Needed because `buildSidebar()`'s
`tabState.subscribe('running', ...)` call would otherwise add one more permanent subscriber
on every login (referencing an increasingly-detached chain of previous sidebar containers)
across repeated login/logout cycles within the same page load — a real, reachable leak now
that deactivate→reactivate is possible, whereas before this feature `buildSidebar()` only
ever ran once per page load.

**`content/sidebar.js`** — the running-subscriber is now a named function
(`handleRunningSync`) stashed on the container as `container._runningSubscriber`, and the
independent memory-poll `setInterval` is stashed as `container._memoryPollInterval` — both
read and cleaned up by `deactivateExtensionUI()` before the container is removed, closing
the leak above and an equivalent one for the interval (which would otherwise keep polling
forever against detached DOM nodes after every logout).

**`content/inlinePanel.js`** — `initManualToggle()`'s document-level click listener is
registered exactly once per page load (existing `window.__extManualToggleInit` guard) and
was never designed to be removed. Since it can no longer assume "if I exist, we're logged
in" once live deactivation is possible, it now checks `isAuthGateActiveSync()` at the top of
every click and bails out if the gate is currently closed.

**`content/nightMode.js`, `content/filterSimilar.js`, `content/filterTags.js`** — each
self-initializes independently of `content.js` (their own top-level IIFEs), so each gained
an explicit `activate*()`/`deactivate*()` pair (idempotent, guarded by their existing
`_...Authed` flags) and registered both with `onAuthGateChange()`. Deactivation goes further
than just flipping the feature off: `deactivateNightMode()`/`deactivateFilterSimilar()`
remove their injected `<style>` tags entirely (not just the triggering class), and
`deactivateFilterTags()` un-hides everything and disconnects its `MutationObserver` — all
three revert fully to the untouched-page state, matching content-script-startup gating
rather than just "settings off."

**Not exercised in a browser** — per the new Verification rules (this session's environment
has no browser access). What the user must test manually, per TASK 1's own instructions:
1. Open a Relay tab while logged out (sidebar should be absent).
2. Log in via the popup (send code, verify) — **expected: sidebar/features appear on the
   already-open tab immediately, no refresh.**
3. Log out via the popup — **expected: sidebar disappears, loop stops if it was running, no
   refresh.**
4. Repeat the login→logout cycle 2–3 times in the same tab and check the console for
   `[EXT][...][tabState] subscribe` / `[EXT][...][sidebar]` log volume — should not grow
   per cycle (confirms the unsubscribe/clearInterval cleanup is actually working, not just
   present in source).

### 2026-07-20 — Investigated reported bug: email field restricted to 6-10 digits

**No code change.** Reported: the previous entry's 6–10 digit `maxlength`/regex restriction
was hitting the email input, not just the code input. Reread `popup/popup.html` and
`popup/popup.js` line by line looking for this:

- `popup-auth-email` (`popup.html:23`) — `type="email"`, no `maxlength`, no `pattern`. Read
  by `popup.js:230` into a local `email` var, used only for `signInWithOtp`.
- `popup-auth-code` (`popup.html:33`) — `type="text"`, `maxlength="10"`, `pattern="[0-9]*"`.
  Read by `popup.js:258` into a local `code` var; the `/^\d{6,10}$/` check (`popup.js:262`)
  runs only against this variable, only inside the Verify click handler.
- They are already two separate `<input>` elements with distinct `id`/`data-testid`, inside
  mutually-exclusive steps (`popup-auth-step-email` / `popup-auth-step-code`, toggled via
  `hidden`). Checked `popup.css` for anything that could make them visually overlap despite
  being distinct in the DOM (stray `position:absolute`, a rule defeating `[hidden]`) — found
  nothing.

Could not reproduce or locate the described bug in the current source. No browser is
available in this working environment to test live, so this is a static-read finding, not a
verified "no bug exists" — the most likely explanation is a stale unpacked-extension load in
Chrome (extension files don't hot-reload on save; needs a manual reload via
`chrome://extensions`). Added TC-AUTH-5 (`docs/TEST_CASES.md`) as a regression test —
full-length realistic email address in, full round trip through to logged-in state — so this
stays caught if it's a real, intermittent, or since-reintroduced issue. Flagged to the user to
reload the extension and retest, or describe the exact symptom in more detail if it persists.

### 2026-07-20 — OTP code length, popup login-only gating UI, PAT 10% markup

**Fix 1 — OTP code length.** Files changed: `popup/popup.html`, `popup/popup.css`,
`popup/popup.js`.

Supabase sends 8-digit codes; the code input was hardcoded to `maxlength="6"` and validated
only for non-empty, so an 8-digit code would get silently truncated to 6 characters by the
input itself before the dispatcher could even submit it. `popup-auth-code` now has
`maxlength="10"`, placeholder changed to "Digits only" (was "6-digit code"), and a new
`<label for="popup-auth-code">Code from email</label>` (`.popup-auth-field-label`) added
above the field. Verify-click validation replaced the "non-empty" check with
`/^\d{6,10}$/.test(code)` — digits only, length 6–10, not a fixed length — with a matching
error message ("Code must be 6-10 digits, numbers only.").

**Fix 2 — popup shows only the login block when logged out.** Files changed:
`popup/popup.html`, `popup/popup.css`, `popup/popup.js`.

Previously the popup showed the Account/login section plus every feature control
simultaneously regardless of login state (gating was content-script-side only, from the prior
entry below). Every control from "Display & Alerts" through "Booking" and the "Reset to
defaults" footer is now wrapped in one `popup-features` container. `showAuthStep()` — already
the single place that toggles which of the three auth steps is visible — now also toggles
`popup-features.hidden` in the same call, so login state and feature visibility can never
drift apart. `popup-auth-gate-note`'s text changed to the requested headline: "Free access —
sign in with your email to activate Torren Relay" (was "Sign in with your email to activate
Torren Relay — free."), and its styling promoted from a small muted note to an actual
headline (14px/700 weight) since it's now the only thing a logged-out dispatcher sees besides
the form. Logged-in state is unchanged: email + Log out at top (`popup-auth-step-loggedin`),
features below.

**Fix 3 — PAT default markup: flat +$5000 → 10%.** Files changed: `content/patModal.js`,
`docs/SAFETY.md`.

`PAT_TEST_MARKUP_USD = 5000` replaced with `PAT_PAYOUT_MARKUP_RATE = 1.10`. Default
`Payout = board payout × 1.10`, rounded to 2 decimals (`parseFloat((boardPayout * 1.10).toFixed(2))`).
Dispatcher can still edit the field freely afterward — no change to that behavior.

**Edge case (as specified):** if board payout is missing/unparseable (`payoutNum` null, or
`parseNumStr` falls back to `0`), the modal does **not** prefill 10% of nothing:
- `payoutMissing = !(boardPayout > 0)` computed once; when true, `ext-pat-payout` starts
  **empty** (not `"0.00"` or any other placeholder value) and `ext-pat-permile` also starts
  empty (can't derive $/mi from a missing payout).
- New `ext-pat-payout-warning` element (red text, directly under the Payout field): "Board
  payout could not be read — enter payout manually". Visibility and Confirm's disabled state
  are both driven by one new `updateConfirmEnabled()` (defined in the footer section,
  referenced from the payout-input listener and from the async city-resolution completion
  block) — `confirmBtn.disabled = blockingErrors.length > 0 || !originCityObj || !destCityObj
  || !currentPayoutValid()`. Typing a valid positive number into Payout live-clears the
  warning and re-enables Confirm (once cities are also resolved) — this is a genuinely
  recoverable state, unlike the pre-existing TZ/loading-type `blockingErrors`, which stay
  disabled for the life of the modal instance.
- The Confirm-click handler's existing `if (isNaN(payoutVal) || payoutVal <= 0)` check is
  unchanged — kept as a second, redundant safety net.

**`docs/SAFETY.md` updated** — the "Network write — PAT order upsert" section previously
described the flat `+$5000` as a deliberate safety margin ("unrealistic price that will be
rejected or immediately visible"). That property no longer holds: a 10% markup is a plausible
real carrier offer, not an obviously-fake one. Rewrote that bullet to say so explicitly and to
note the dispatcher-must-click-Confirm gate is now the primary safety control for this
feature, plus documented the new missing-payout guard.

**Also this session: fixed a real doc-hygiene bug.** A `docs/STATE.md` had been created and
maintained for the past several turns of this session under the belief that no `STATE.md`
existed — an earlier directory search only checked `docs/*.md` and missed the real,
git-tracked `STATE.md` at the repo root (Ukrainian, last content-updated 2026-07-07, several
commits behind actual repo state). The duplicate `docs/STATE.md` has been deleted; its content
was merged into the real root `STATE.md`, which is now the single current-state file, written
in English to match every other doc in `docs/`.

### 2026-07-20 — Two OTP login fixes: pending-state persistence + full feature gating

**Fix 1 — pending code state lost on popup close.** Files changed: `utils/storage.js`,
`popup/popup.js`.

`pendingAuthEmail` was an in-memory-only JS variable — closing the popup after "Send code"
but before entering the code silently reset the flow back to the email step on reopen, even
though the code was still valid server-side (forcing an unnecessary resend). New
`AUTH_PENDING_KEY = 'authPendingEmail'` (`utils/storage.js`, deliberately outside
`STORAGE_KEYS` for the same reason as `SUPABASE_SESSION_KEY` — "Reset to Defaults" must not
disrupt an in-flight login) persists `{ pendingEmail, step: 'code' }` on successful
`signInWithOtp`. New `restorePendingOrEmailStep()` in `popup.js`: called by `restoreSession()`
whenever there is no valid/refreshable session — resumes the code step (pre-filled email,
status message) if a pending email is stored, otherwise falls back to the email step. Cleared
on successful verify, "Use different email", and logout.

**Fix 2 — login gating of every extension feature.** Files changed: `manifest.json`,
`content/content.js`, `content/sidebar.js`, `content/nightMode.js`, `content/filterSimilar.js`,
`content/filterTags.js`. New file: `utils/authGate.js`.

Every feature now requires an active Supabase session — resolves BACKLOG.md's "Login gating
of features — later". New shared module `utils/authGate.js`, added to `manifest.json`
`content_scripts` (after `utils/storage.js`, before `utils/tabState.js`, alongside newly
content-script-loaded `utils/supabaseConfig.js` and `vendor/supabase.min.js`):

- `getAuthGate()` — cached per page load. Reads `SUPABASE_SESSION_KEY`; if the session is
  still valid, calls `auth.setSession()`; if expired, calls `auth.refreshSession()` and
  writes the refreshed session back to storage (**silent refresh — edge case from the
  instructions: an expired-but-refreshable session never closes the gate or logs anyone
  out**). Only a missing session or a genuinely failed refresh reports the gate closed.
  Content scripts never clear a bad session themselves — that stays `popup.js`'s job
  (`restoreSession()`), so N open tabs can't race each other into logging the dispatcher out
  over a transient refresh hiccup.
- `recheckAuthGate()` — bypasses the cache for a fresh check; used at toggle-time.

Two checkpoints wired in:
1. **`content/content.js`'s startup IIFE** — gate checked before `tabState.init()`,
   `buildSidebar()`, `initManualToggle()`. Closed gate ⇒ none of those run: no sidebar, no
   inline panel, no click listeners of ours anywhere on the page. The Amazon Relay page itself
   is completely untouched — same as the extension being uninstalled.
2. **`content/nightMode.js`, `content/filterSimilar.js`, `content/filterTags.js`** — each
   self-initializes independently of `content.js` (top-level `(async function(){...})()` in
   each file, reading its own storage key on script load), so each needed its own gate check
   in its init IIFE, plus an `_...Authed` flag guarding its live `chrome.storage.onChanged`
   listener (otherwise a settings change from another popup instance could still apply Night
   Mode etc. to a logged-out tab).
3. **`content/sidebar.js`'s `toggleRunning()`** — turning the loop **on** (not off)
   re-checks the gate via `recheckAuthGate()`, since a tab can stay open for hours past the
   initial page-load check. Closed gate ⇒ refuses to start, briefly changes the play/pause
   button's `title` to a sign-in prompt (reverts after 3s), never touches Amazon's DOM.

`manifest.json`: `utils/supabaseConfig.js` and `vendor/supabase.min.js` added to
`content_scripts` (previously popup-only) so `authGate.js` can use the same, already-vetted
`supabase-js` client/config as `popup.js` rather than hand-rolling a second REST client.

`popup/popup.html`/`popup.css`/`popup.js`: new `popup-auth-gate-note` line — "Sign in with
your email to activate Torren Relay — free." — shown above the login form whenever not
logged in, hidden once logged in.

**Known limitation (documented, not fixed here):** no live cross-context reactivation —
logging in/out via the popup does not retroactively affect an already-loaded Relay tab; a
reload is required. See BACKLOG.md.

**Not live-tested end-to-end** (no browser available in this session): the refresh-on-expiry
path, the gate blocking an actual logged-out page load, and the pending-state popup
reopen — all implemented per the design above and syntax-checked, but not manually driven
through a loaded-unpacked Chrome session. See docs/TEST_CASES.md TC-AUTH-1/2/3.

### 2026-07-20 — Stop tracking real Supabase credentials in git

Files changed: `.gitignore`. New file: `utils/supabaseConfig.example.js`.

`utils/supabaseConfig.js` (holds the real `SUPABASE_URL`/`SUPABASE_ANON_KEY`) added to
`.gitignore` — it was still untracked/uncommitted, so this is a pre-emptive guard, not a
history rewrite. `utils/supabaseConfig.example.js` committed instead, with placeholder
values (`YOUR_PROJECT_REF`, `YOUR_ANON_OR_PUBLISHABLE_KEY`), so a fresh checkout has a
documented file to copy from. No behavior change — `popup.html` still loads
`utils/supabaseConfig.js` (not the `.example.js`), so login keeps working locally as long as
that file exists on disk.

### 2026-07-17 — Supabase login wired live + rebrand to "Torren Relay"

Files changed: `manifest.json`, `popup/popup.html`, `popup/popup.js`. New file: `utils/supabaseConfig.js`.

**Login wired live:** `utils/supabaseConfig.js` created with the real project's `SUPABASE_URL` / `SUPABASE_ANON_KEY` (publishable key — safe to ship; RLS is the actual access boundary), provided by the PM. This was the only missing piece from the login feature added earlier today (see the "Popup login via Supabase email OTP" entry below) — `supabaseClient` now initializes and the three-step OTP flow is functional. Verified reachable without sending any email: `GET /auth/v1/settings` on the project returned HTTP 200 with `email: true`, `mailer_autoconfirm: false` (confirmation emails are real, not auto-confirmed — matches the OTP flow as designed). `vendor/supabase.min.js` (v2.110.7 UMD, vendored the same session the feature was built) was already in place and re-verified unchanged.

**Rebrand (partial, scoped):** extension name changed from "Amazon Relay Helper" to "Torren Relay" in `manifest.json` (`name`, `action.default_title`) and in the popup (`<title>`, `.popup-title`). `description` in `manifest.json` intentionally left as-is — full copy rewrite comes before Web Store submission. **Not changed:** `utils/constants.js`'s `EXT_NAME` constant (still "Amazon Relay Helper"), which feeds the on-page sidebar title (`content/sidebar.js` → `ext-sidebar-title`) — out of the requested scope, so the in-page sidebar still shows the old name for now. Flagging this seam since it's a visible inconsistency between the popup and the injected page UI until `EXT_NAME` is included in a later rebrand pass.

### 2026-07-17 — FEATURE: Popup login via Supabase email OTP

Files changed: `manifest.json`, `popup/popup.html`, `popup/popup.css`, `popup/popup.js`, `utils/storage.js`. New file: `vendor/supabase.min.js` (vendored `@supabase/supabase-js` v2.110.7 UMD build, pinned from jsdelivr's mirror of the npm package on 2026-07-17 — MV3 forbids remote-hosted scripts, so it is bundled rather than CDN-loaded).

New "Account" section at the top of the popup, above "Display & Alerts": three-step flow, all elements `data-testid`'d —
1. **`popup-auth-step-email`** — email input (`popup-auth-email`) + "Send code" (`popup-auth-send-code`) → `supabase.auth.signInWithOtp({ email })`.
2. **`popup-auth-step-code`** — 6-digit code input (`popup-auth-code`) + "Verify" (`popup-auth-verify`) → `supabase.auth.verifyOtp({ email, token, type: 'email' })`, plus "Resend code" (`popup-auth-resend`) and "Use different email" (`popup-auth-change-email`).
3. **`popup-auth-step-loggedin`** — email display (`popup-auth-email-display`) + "Log out" (`popup-auth-logout`) → `supabase.auth.signOut()`.

Status/error line: `popup-auth-status` (all text via `textContent`, never `innerHTML`).

**Session persistence:** on successful verify, the full Supabase session object is written to `chrome.storage.local` under `SUPABASE_SESSION_KEY = 'supabaseSession'` (`utils/storage.js`). This key is deliberately **not** added to `STORAGE_KEYS` — "Reset to Defaults" clears `Object.values(STORAGE_KEYS)` and must not log the dispatcher out as a side effect of resetting preferences.

**Restore on popup open (`restoreSession()`):** reads the stored session; if `expires_at` is more than 30s out, calls `auth.setSession()` to rehydrate the client and shows the logged-in state; if expired (or inside the 30s buffer), calls `auth.refreshSession({ refresh_token })`, persists the refreshed session, and shows logged-in. Any failure (invalid/expired refresh token, network error) clears the stored session and falls back to the email step.

**Client config:** `supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false })` in `popup.js`. `persistSession`/`autoRefreshToken` are off because we manage `chrome.storage.local` persistence and refresh manually (instructions 3–4) rather than relying on supabase-js's own `localStorage`-based session store, which wouldn't survive across popup instances predictably.

**`SUPABASE_URL` / `SUPABASE_ANON_KEY`:** read from `utils/supabaseConfig.js`, loaded via `<script>` tag in `popup.html` between `vendor/supabase.min.js` and `popup.js`. **That file does not exist yet** — per explicit instruction, no placeholder credentials were invented or committed. Until it's created with real values, `supabaseClient` stays `null` and every auth action shows "Login not configured." — no other extension feature is affected. `manifest.json` `host_permissions` gained `https://*.supabase.co/*` (standard Supabase-hosted project domain — flag if the project uses a custom domain).

**Gating:** none. Per instruction, login only collects the user list for now — every existing feature (detection loop, PAT Helper, Fast Book, etc.) works identically regardless of login state. See BACKLOG.md "Login gating of features — later".

### 2026-07-17 — FEATURE: Multi-domain support (all Amazon Relay regional domains)

Files changed: `manifest.json`.

`host_permissions` and `content_scripts.matches` expanded from `https://relay.amazon.com/*` only to the full set of Amazon Relay regional domains: `relay.amazon.ca`, `relay.amazon.co.jp`, `relay.amazon.co.uk`, `relay.amazon.com`, `relay.amazon.cz`, `relay.amazon.de`, `relay.amazon.es`, `relay.amazon.fr`, `relay.amazon.it`, `relay.amazon.in`, `relay.amazon.pl`.

Codebase audit for hardcoded `relay.amazon.com` strings outside `manifest.json`: none found. `content/patApi.js` (`PAT_UPSERT_PATH`, `CITY_SEARCH_BASE`) already uses relative paths passed to `fetch()`, so requests resolve against whatever regional domain the content script is running on — no code change needed there. Remaining hits were docs/test files and a README example URL (informational only, not touched).

Deferred: non-US domains may return city/state data in different formats (locale-aware city normalization, address formats, currency). No behavior change made here — will be evaluated per-case once we have real captured data from a non-`.com` domain.

### 2026-07-15 — FIX: Night Mode — shift dark ramp from near-black to navy-slate

Files changed: `utils/designTokens.js`, `popup/popup.css`, `content/nightMode.js`.

Retuned the entire dark-mode elevation ramp from a near-black neutral scale to a lighter dark-navy/slate scale, per explicit target values, across both color systems that make up Night Mode:

**`utils/designTokens.js`** (feeds our own injected UI — inline panel, action bar, PAT modal, sidebar — via `--ext-*` CSS custom properties, `html.ext-night` block only):
- `--ext-bar-bg` / `--ext-n100` (level 1): `#1c1f24`/`#23272d` → `#223140`.
- `--ext-surface` (level 2 — panel/input/button surface): `#23272d` → `#2b3d4f`.
- `--ext-n200` (border/hover token): `#2c313a` → `#3e5468`.
- `--ext-n300`/`--ext-n400`: `#3a4250`/`#586070` → `#4a6278`/`#5b7690` (kept monotonic progression).
- `--ext-n500` (secondary text): `#7a8c9c` → `#9fb3c8`.
- `--ext-n700`: `#b0bcca` → `#c3d2df`.
- `--ext-n900` (primary text): `#e5edf5` → `#e8eef4`.
- `--ext-accent-bg` lightened `#172236` → `#1f3350` to stay visibly distinct from the new (lighter) base. `--ext-accent`/`--ext-accent-hover`/`--ext-accent-text` left unchanged, per "keep accent similar to current."

**`popup/popup.css`**: same `html.ext-night` values applied, since this file is a documented duplicate of `designTokens.js`'s token block (popup is a separate document and can't read the content-script-injected `<style>`).

**`content/nightMode.js`** (separate hardcoded hex ramp used to override Amazon's own page DOM — cards, filter bar, inputs, chips, buttons — does not read the CSS custom properties above):
- `DK_BASE` (level 0 / page bg): `#16181c` → `#1a2634`.
- `DK_RAISED` (level 1): `#1e2126` → `#223140`.
- `DK_OVERLAY` (level 2): `#262a31` → `#2b3d4f`.
- `DK_HIGH`: `#2e333b` → `#34495c`.
- `DK_BORDER`/`DK_BORDER_STRONG`: switched from translucent white overlays (`rgba(255,255,255,.09/.14)`) to solid navy-slate hex (`#3e5468`/`#4a6278`) matching the explicit border target.
- `DK_TEXT`/`DK_MUTED`/`DK_FAINT`: `#e8eaed`/`#a8b0b9`/`#6b7480` → `#e8eef4`/`#9fb3c8`/`#7488a0`.
- `DK_ACCENT_BG`: `#172236` → `#1f3350` (kept in sync with `designTokens.js`).
- New `DK_CHIP_BG` (`#2e4257`) / `DK_CHIP_BORDER` (`#4f6f88`) tokens: filter chips/pills now get a distinct fill + lighter border + `DK_ACCENT_TEXT` (light blue) label, instead of reusing the plain level-2 input/button styling, so they read as chips.

Load card selectors (`.load-card`, `.wo-card-header`, `.load-card__selected`) were not touched directly — they continue to inherit `DK_RAISED`/`DK_BORDER_STRONG` from the ramp, so they lighten along with everything else without any layout change.

---

### 2026-07-15 — FIX: Night Mode — elevation contrast outside load cards

Files changed: `content/nightMode.js`.

Fixed a flat/boundary-less look in dark mode: everything except load cards (filter bar, left sidebar blocks, inputs, dropdowns, filter chips, buttons) had no explicit background rule and fell through to the universal "transparent" reset, rendering near-black against the page background. Load card styling is unchanged.

- Added a level-1 (`DK_RAISED`) surface rule for the filter/search panel and sidebar blocks (`[role="search"]`, `[role="complementary"]`, `aside`, `[class*="filter" i]`, `[class*="search-panel" i]`) — Amazon uses hashed classes here so there's no stable selector to target directly; matches the existing role/class-substring pattern already used for header/nav/utility-bar.
- Promoted inputs, selects, dropdown/field wrappers, filter chips/pills, and generic buttons from level 1 (`DK_RAISED`) to level 2 (`DK_OVERLAY`) so they read as distinct controls sitting on top of the level-1 panel, instead of blending into it.
- Added a border to the dropdown/field wrapper and chip/pill rules, which previously had none.
- Consolidated all touched borders onto the single `DK_BORDER` token (was a mix of `DK_BORDER` and `DK_BORDER_STRONG`) for a consistent subtle-gray boundary instead of invisible/none.
- No new tokens introduced — reused the existing `DK_BASE`/`DK_RAISED`/`DK_OVERLAY`/`DK_BORDER` elevation ramp already defined in `nightMode.js`.

---

### 2026-07-14 — FEATURE: Fast Book

Files changed: `utils/constants.js`, `utils/storage.js`, `popup/popup.html`, `popup/popup.js`, `content/inlinePanel.js`.

Adds a 1-click "Fast Book" feature: a toggle in the popup enables a "Fast Book" button injected into every expanded load card's action bar. Clicking it executes Amazon's two-step booking sequence (Book → Confirm) programmatically, triggered only by dispatcher's explicit interaction.

**`utils/constants.js`:**
- `FORBIDDEN_SELECTORS` cleared (matches `docs/SAFETY.md` — the list is now intentionally empty).
- `ALLOWED_CLICK_INTENTS.FAST_BOOK` added for the two booking DOM clicks.

**`utils/storage.js`:**
- `STORAGE_KEYS.FAST_BOOK_ENABLED = 'fastBookEnabled'` added.

**`popup/popup.html`:**
- New "Booking" section added (between Load Board Filters and footer divider) with a Fast Book toggle (`id="popup-fast-book"`, `data-testid="popup-fast-book"`).

**`popup/popup.js`:**
- `KEY_FAST_BOOK_ENABLED` key constant added.
- Wired in all 4 places: initial load, change handler, Reset, and `chrome.storage.onChanged` live-sync.

**`content/inlinePanel.js`:**
- `_fastBookStorageListener` module-level variable tracks the storage change listener for cleanup.
- CSS added for `.ext-action-btn--fastbook` (amber border+text, disabled state).
- `executeFastBook(sheetLoadId, fastBookBtn)`: two-step booking sequence. Step 1 queries `#selected-work-sheet` for `#rlb-book-btn` (text fallback: button with `textContent === "Book"`), calls `isForbiddenElement()`, clicks. Step 2 polls up to 5s for `#rlb-book-trip-confirm-booking-btn` (text fallback: "Book"/"Confirm"/"Confirm booking" in a new button not equal to step 1), calls `isForbiddenElement()`, clicks. Button shows "Booking…" → "Booked!" on success, restores on error/timeout.
- `buildActionBar()`: Fast Book button appended last, `display:none` initially.
- `showInlinePanel()`: reads `fastBookEnabled` from storage to set initial button visibility; wires click handler; adds `chrome.storage.onChanged` listener for live popup-toggle sync. Previous listener is removed before re-attaching.
- `removeInlinePanel()`: removes `_fastBookStorageListener` and clears it.

**Safety:** `isForbiddenElement()` is called before each `.click()` per SAFETY.md. No auto-trigger path exists — booking only fires from dispatcher's explicit Fast Book button click. (Click 4 in SAFETY.md.)

---

### 2026-07-14 — FEATURE: ext-action-post — enable 40' Container and 26' Truck

Files changed: `content/patApi.js`, `content/patModal.js`.
Docs updated: `docs/api-samples.md`, `docs/CHANGELOG.md`.

Enums confirmed from Amazon API data (not full payload capture — if a post fails, recapture via DevTools Network filter "upsert"):
- `"40' Container"` → `["FORTY_FOOT_CONTAINER"]`
- `"26' Truck"` → `["TWENTY_SIX_FOOT_BOX_TRUCK"]`

**`content/patApi.js`:** Added `PAT_EQUIPMENT_TYPES_40_CONTAINER` and `PAT_EQUIPMENT_TYPES_26_TRUCK` constants.

**`content/patModal.js`:** Both board labels added to `PAT_EQUIPMENT_MAP`. No other changes — the existing `formState.equipmentTypes` / `buildPatPayload` path handles them identically to 53' Container.

---

### 2026-07-14 — FIX: ext-action-post — use detail-panel stop address for PAT city resolution

Files changed: `content/patApi.js`, `content/patModal.js`.

**Root cause:** Board card summary stops (`.wo-card-header__components` text) can carry a 2-letter state-code prefix before the city name, e.g. `"DNA4 NC CONCORD, NC 28025"`. `parseBoardStop` strips the warehouse code (`DNA4 `) leaving `"NC CONCORD, NC 28025"`, then extracts city `= "NC CONCORD"`. The existing state-name prefix stripping loop only matches full names from `STATE_NAMES_SORTED` (e.g. `"north carolina"`), so `"nc"` is never stripped.

The detail-panel stop `address` field (from `parseStopBlock` in `inlinePanel.js`) contains the same text that Amazon displays in the pick-up/drop-off view: `"Concord, NC 28025"` — clean, no prefix.

**Fix:**

**`content/patApi.js`:**
- Added `parseDetailAddress(address)` — parses `{ city, state }` from a detail stop address string. Matches `"CITY, ST [ZIP]"` anchored to end-of-string; handles optional street prefix joined by `", "`. Returns `{ city: '', state: '' }` on no-match.
- `resolvePATCity(input)` now accepts either a raw board-stop string (calls `parseBoardStop` internally — unchanged behavior) OR a pre-parsed `{ city, state }` object (skips `parseBoardStop`). Branch is determined by `typeof input === 'object'`.

**`content/patModal.js`:**
- `firstSeg`/`lastSeg`/`firstStop`/`lastStop` moved up to the sync extraction block (previously declared again in the time-parsing section — now declared once, used by both city and time logic).
- `parseDetailAddress(firstStop.address)` / `parseDetailAddress(lastStop.address)` called for origin and dest. Both board string and detail address are logged side by side (`city source comparison`) so the fix can be verified for one load.
- If detail parse succeeds (non-empty city), `originInput`/`destInput` = `{ city, state }` objects → passed to `resolvePATCity` bypassing `parseBoardStop`. Falls back to `originStop` string if detail address is absent or unparseable.

**Test:** Open a load whose board card shows `"NC CONCORD"` or similar prefixed city. Open the PAT modal. Logger should show `detailOriginParsed: { city: "Concord", state: "NC" }` alongside the corrupted board stop. Origin in the modal should resolve to `"CONCORD, NC"` instead of failing.

---

### 2026-07-14 — equipment-type collector — confirmed enums not in page state; removed dead strategy

Files changed: `content/loadParser.js`.

**Confirmed:** Amazon's equipment enum codes are NOT present in the page DOM, ARIA attributes, or React fiber state. Verified by calling `getEquipmentEnumMap()` on the live PAT form with the Equipment dropdown expanded — all three strategies (native select, ARIA fiber probe, BFS over 4000 fiber nodes) returned null.

**Authoritative source:** capture each new equipment type's enum from the real upsert payload via DevTools Network → filter "upsert" when posting that type manually. Add to `api-samples.md` and a new `PAT_EQUIPMENT_TYPES_*` constant per `api-samples.md` §5.

**Change:** `getEquipmentEnumMap()` removed from `window.__EXT_DEBUG`. `getSeenEquipmentTypes()` (display-name list from the board) kept as-is.

---

### 2026-07-14 — FEATURE: ext-action-post — enable 53' Container and Chassis equipment type

Files changed: `content/patApi.js`, `content/patModal.js`.
Docs updated: `docs/api-samples.md`, `docs/CHANGELOG.md`.

Live capture confirmed: payload structure for 53' Container and Chassis is identical to 53' Trailer except `equipmentTypes: ["FIFTY_THREE_FOOT_CONTAINER"]` (single element vs. 5-element trailer list).

**`content/patApi.js`:**
- Added `PAT_EQUIPMENT_TYPES_CONTAINER = ['FIFTY_THREE_FOOT_CONTAINER']`.
- `buildPatPayload` no longer hardcodes `PAT_EQUIPMENT_TYPES_53`; reads `formState.equipmentTypes` (array) and `formState.equipmentTypes[0]` for `visibleEquipmentTypes`. No other payload field changed.

**`content/patModal.js`:**
- Equipment gate replaced: `equipment !== "53' Trailer"` check → `PAT_EQUIPMENT_MAP` object lookup (`"53' Trailer"` → `PAT_EQUIPMENT_TYPES_53`, `"53' Container and Chassis"` → `PAT_EQUIPMENT_TYPES_CONTAINER`). Unknown types (including empty) still hit the existing `showSimplePatModal` paths unchanged.
- `formState` now includes `equipmentTypes: patEquipmentTypes` — passed through to `buildPatPayload`.
- Adding a future equipment type requires: new constant in `patApi.js`, one new key in `PAT_EQUIPMENT_MAP`, captured sample in `api-samples.md`.

**`docs/api-samples.md`:**
- Section 4 added: "order-upsert — 53' Container and Chassis (captured 2026-07-14)".
- `FIFTY_THREE_FOOT_CONTAINER` added to enums list.
- Old ❌ "Unsupported equipment" section updated to reflect no remaining blocked types.

---

### 2026-07-14 — FEATURE: ext-action-post — prefix+subsequence city fallback for abbreviated board names

Files changed: `content/patApi.js` (`isSubseq`, `resolvePATCity`).
Docs updated: `CHANGELOG.md`, `TEST_CASES.md`.

**Problem:** Amazon abbreviates some city names on the board by dropping vowels — e.g. "BURLNGTN TWP, NJ" for "BURLINGTON TWP, NJ". The cities API has no entry for "BURLNGTN TWP"; exact and starts-with searches both return no match.

**New fallback (4th path in `resolvePATCity`):**
1. Strip non-letters from the abbreviated name → `abbrevLetters` (e.g. `"BURLNGTNTWP"`).
2. Take the first 4 characters of the city string as a prefix → `"BURL"`.
3. GET `/api/loadboard/filters/cities/search/BURL` — returns all cities whose name starts with the prefix.
4. Filter results to `stateCode === state`.
5. For each candidate, strip non-letters → `candLetters`; call `isSubseq(abbrevLetters, candLetters)`.
6. If **exactly one** candidate passes → use it (strong match).
7. If **zero** → no match, return null (same as before).
8. If **more than one** → ambiguous, log names, return null (never guess).

Added helper `isSubseq(abbrev, full)` — returns true when every character of `abbrev` appears in `full` in order (letter subsequence). Classic algorithm, O(n+m).

Guards: only runs when `abbrevLetters.length >= 4` AND `prefix.trim().length >= 3`; skips for trivially short names.

**Test:** `"BURLNGTN TWP, NJ"` — abbrevLetters `"BURLNGTNTWP"` is a subsequence of `"BURLINGTONTWP"` (from "BURLINGTON TWP") but not of `"BURLINGTON"` alone (too short — can't absorb TWP). Result: 1 candidate → `BURLINGTON TWP, NJ`.

---

### 2026-07-14 — BUG FIX: ext-action-post — payout null fallback surfaces as $5000.00

Files changed: `utils/loadStore.js` (comment only), `content/patModal.js`.
Docs updated: `CHANGELOG.md`.

**Root cause:** `loadUnit.payoutNum` is `null` when `.wo-total_payout` was absent from the card DOM at the time `parseLoads()` (or on-demand Phase 1 parse) ran. The previous `|| 0` collapsed null→0, so `initPayout = 0 + PAT_TEST_MARKUP_USD = 5000`.

**Not a comma bug:** `_parsePayoutNum` in `loadStore.js` already calls `.replace(/[$,]/g, '')` before `parseFloat` — identical normalization to `parseNumStr`. `"$2,320.23"` → `2320.23` is handled correctly when the payout string IS present.

**Fix — `patModal.js`:**
Replaced `loadUnit.payoutNum || 0` with a null-aware two-step:
1. If `payoutNum` is non-null, use it (normal path).
2. Else, call `parseNumStr(loadUnit.payout)` on the raw payout string — direct fallback that also strips `$` and commas (handles the case where `payoutNum` was never derived or was overwritten with null by a subsequent merge).
3. Added `logger.warn` when `payoutNum` is null so the fallback is visible in DevTools (not silent).

**`loadStore.js`:** comment added to `_parsePayoutNum` documenting why it cannot call `parseNumStr` directly (load order: loadStore at position 18, patApi at position 31) and confirming equivalent normalization.

---

### 2026-07-14 — BUG FIX: ext-action-post — miles parsing, payout rounding, city normalizer (3 bugs)

Files changed: `content/patApi.js`, `content/patModal.js`.
Docs updated: `AMAZON_SELECTORS.md`, `TEST_CASES.md`, `CHANGELOG.md`.

**Bug 1 — Miles parsing (comma thousands-separator):**
`loadUnit.distance` values like `"1,233.2 mi"` gave `distMiles = 1` (parseFloat stops at the comma) → minMiles = 0, maxMiles = 26.
Added shared helper `parseNumStr(str)` in `patApi.js`: strips `$` and `,` before parseFloat, returns `0` on NaN.
`patModal.js`: replaced two-line `distStr`/`parseFloat(distStr)` with `var distMiles = parseNumStr(loadUnit.distance)`.

**Bug 2 — Payout rounding at declaration:**
`boardPayout + PAT_TEST_MARKUP_USD` (e.g. `2279.86 + 5000`) can produce `7279.860000000001` as a raw float due to IEEE 754 addend mismatch. The input field display was already guarded by `.toFixed(2)`, but `initPayout` itself remained the raw float, appearing in the logger and any direct downstream use.
Fixed: `var initPayout = parseFloat((boardPayout + PAT_TEST_MARKUP_USD).toFixed(2))` — all uses of `initPayout` now see a clean 2-decimal value.

**Bug 3a — Full state name prefixed before city name in boardStops:**
Entry like `"ILL1 Illinois AURORA, IL 60505"` → after station-code drop: `"Illinois AURORA, IL 60505"` → comma split gives city `"Illinois AURORA"` (wrong).
Added `STATE_NAMES_SORTED` constant (all keys from `STATE_NAME_TO_CODE`, sorted longest-first, computed once at load).
Added loop in `parseBoardStop` after city extraction: if the city string (lowercase) starts with a state name + space, strip the prefix. `"Illinois AURORA"` → `"AURORA"`. Longest-first sort prevents `"north"` matching before `"north carolina"`.

**Bug 3b — Dotted abbreviation city names fail API lookup:**
`"MT. JULIET"` sent verbatim to the city search API may return no matching entry.
Added `ABBREV_EXPAND` constant (`MT.→MOUNT`, `ST.→SAINT`, `FT.→FORT`, regex with `\b` word boundary).
Added retry in `resolvePATCity`: if primary + fallback match both fail, expand abbreviations in the city string; if the string changed, issue a second GET to the city search API and re-run primary + fallback on the expanded name. Retry fires only when abbreviation expansion actually changes the string.

---

### 2026-07-08 — BUG FIX: "startLocationList" → "originCityInfo" (invented key, wrong shape)

Files changed: `content/patApi.js` (`buildPatPayload`).
Docs updated: `AMAZON_SELECTORS.md`, `CHANGELOG.md`.

The origin city was sent as `"startLocationList": [{ ... }]` — an invented key wrapping the object in an array. The capture has `"originCityInfo": { ... }` — a single object at the top level, no array. Fixed: key renamed, array brackets removed. No change to the object's field set.

---

### 2026-07-08 — BUG FIX: buildPatPayload structural mismatch → HttpMessageNotReadableException

Files changed: `content/patApi.js` (`buildPatPayload`).
Docs updated: `AMAZON_SELECTORS.md`, `CHANGELOG.md`.

Server returned HTTP 400 `HttpMessageNotReadableException` — the server could not deserialize the JSON body due to structural mismatches (wrong key names / bare numbers where objects were expected).

**Keys corrected (4 confirmed mismatches from live capture):**
- `totalCost`: `currency:"USD"` → `unit:"USD"`
- `costPerDistance`: `{value, distanceUnit:"MILES"}` → `{value, currencyUnit:"USD", distanceUnit:"mi"}`
- `minDistance` / `maxDistance`: bare number → `{value, unit:"mi"}`
- `originCityRadius` / `destinationCityRadius`: bare number → `{value, unit:"mi"}`

**City object shapes corrected:**
- `originCityInfo`: was invented as `startLocationList:[{...}]` (array) — capture has `originCityInfo:{...}` (single object). Corrected 2026-07-08.
- `endLocationList[0]`: was passing full object — capture requires stripped shape: `{displayValue, stateCode, isCityLive:false, latitude, longitude, name}` (no country/isAnywhere/uniqueKey)

**Static fields added (previously absent, all confirmed from live capture):**
`runType:"ONE_WAY"`, `distanceOrDuration:"DISTANCE"`, `payoutType:"FLAT_RATE"`, `visibleProvidedTrailerType:"AMAZON_PROVIDED"`, `providedTrailerType:"AMAZON_PROVIDED"`, `isLinkedOrder:false`, `isRepostingAllowed:true`, `isAnywhereDestination:false`, `matchingDemands:[]`, `matchingWork:0`, `isCheckingMatchingWork:false`, `isMatchingWorkLoaded:false`, `supplyDriverIdList:[]`, `supplyTransientDriverIdList:[]`, `exclusionCityList:[]`, `endRegionList:[]`, `startTimeWindow:null`, `minDurationInMinutes:null`, `maxDurationInMinutes:null`, `destinationCityInfoForFilter:null`, `auditMetaData:{suggestedCostPerDistance:null,matchOutlookScore:"LOW"}`, `patOrderContext:null`, `cancellationDetails:null`, `repostingDetails:null`.

No change to `submitOrder`, `resolvePATCity`, `resolveLoadingType`, or any other function.

---

### 2026-07-07 — BUG FIX: submitOrder was posting to an invented endpoint

Files changed: `content/patApi.js` (constant + fetch headers).
Docs updated: `AMAZON_SELECTORS.md`, `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`.

**Root cause:** `PAT_UPSERT_PATH` was set to `/relay/rlb/api/pat/create-order` — a path that exists in no live capture and no doc. The correct endpoint, confirmed from a fresh cURL of a real manual Post-a-Truck submission, is `/api/loadboard/orders/upsert`. The wrong endpoint caused 400 InvalidCsrfTokenException because it rejected the CSRF token from the real domain.

**Fix — `content/patApi.js`:**
- `PAT_UPSERT_PATH` → `/api/loadboard/orders/upsert`
- Request header corrected: `x-owp-csrf-token` → `x-csrf-token` (header name confirmed from live capture; meta tag name `x-owp-csrf-token` is unchanged — we read from it, but send as `x-csrf-token`)
- Accept header corrected: `application/json` → `*/*` (confirmed from live capture)
- No Referer header added — browser sends it automatically for same-origin fetch

**Amazon URLs the feature contacts (complete list):**
1. `POST /api/loadboard/orders/upsert` — order creation
2. `GET /api/loadboard/filters/cities/search/<city>` — city resolution
3. `<meta name="x-owp-csrf-token">` — CSRF read (DOM, no network request)

---

### 2026-07-07 — PAT: loadingType combined value is order-insensitive

Files changed: `content/patApi.js` (`resolveLoadingType`).
Docs updated: `AMAZON_SELECTORS.md`, `CHANGELOG.md`.

Live board shows combined loadingType in both orderings: `"Live/Drop"` (previously captured) and `"Drop/Live"` (captured today, blocked by the guard). `resolveLoadingType` now splits on `/`, trims each token, maps `"Drop"→DROP` / `"Live"→LIVE`, and returns `null` on any unrecognized token. When both tokens are present (in any order) the return value is always `["LIVE","DROP"]` — fixed order to match the captured upsert payload. The null-guard behavior is unchanged: an unrecognized token still produces `null`, which the modal surfaces as a blocking error.

---

### 2026-07-07 — PAT on-demand parse: fix nested-card element resolution

Files changed: `content/inlinePanel.js` (new `findLiveOutermostCard` helper + post button handler).
Docs updated: `CHANGELOG.md`, `TEST_CASES.md`.

**Root cause:** `initManualToggle` captures the card element via `ev.target.closest('div.load-card, div.load-card__selected')` — this returns the **innermost** matching ancestor. When Amazon nests `div.wo-card-header--highlighted` inside `div.load-card` (the exact nesting the `parseLoads` dedup was added for), the captured element is the inner node. It contains `div[id]` (Phase 2 / loadId work), but NOT `.equipment-type-text` / `.wo-total_payout` / `.wo-card-header__components` — so `parseOneCard()` on it returns all Phase 1 fields as null. After one loop tick `parseLoads` has merged Phase 1 under the correct outermost loadId, `needsPhase1` becomes false, and the broken on-demand branch is skipped — masking the bug. A stale-after-React-remount `cardElement` is covered by the same fix.

**Fix — `findLiveOutermostCard(loadId)`** (new function, before `showInlinePanel`):
1. `document.getElementById(loadId)` — always live DOM.
2. `.closest('div.load-card, div.load-card__selected')` — nearest card ancestor.
3. Climb via `parentElement.closest(…)` loop to the **outermost** matching container — mirrors `parseLoads` `allCards.filter(elB.contains(elA))` pass.
Selectors: `div.load-card, div.load-card__selected` — identical to the `parseLoads` querySelectorAll pair. `div.wo-card-header--highlighted` excluded: always inner, never outer (parseLoads contains-filter drops it). Returns `null` if `getElementById` finds nothing.

**Fix — post button handler** (inside `showInlinePanel`):
Calls `findLiveOutermostCard(sheetLoadId)` before `parseOneCard`. Logs `usedLive` and `sameNode` at the "Phase 1 missing" log line. Passes `liveCard || cardElement` to `parseOneCard`. Empty-parse error log now includes `usedLive` and `sameNode` for diagnostics.
No change to `initManualToggle`, `parseLoads`, camera/map handlers, PAT modal, or patApi.js.

---

### 2026-07-07 — PAT modal: on-demand Phase 1 parse when loop was never started

Files changed: `content/inlinePanel.js` (post button handler), `content/patModal.js` (equipment gate).
Docs updated: `TEST_CASES.md`, `STATE.md`.

**Problem:** when the dispatcher opens a card and clicks Create Post without ever starting the refresh loop, `parseLoads()` has never run and the LoadUnit has no Phase 1 board fields (payout, boardStops, equipment, distance, loadingType all null). The modal correctly refused with equipment «» unsupported, but the message was confusing.

**Fix — `content/inlinePanel.js`** (`showInlinePanel`, post button handler):
Before calling `openPostModal(sheetLoadId)`, checks `loadStore.getLoadUnit(sheetLoadId)` for missing Phase 1 (equipment null/'' OR boardStops empty). If missing, calls `parseOneCard(cardElement)` directly — confirmed standalone-safe (no knownLoadIds write, no detection pipeline, no tabState, no sound). Replicates the exact `loadStore.mergeLoadUnit(…)` call that `parseLoads()` would have made, including the `boardStops: parsed.stops` field name. Detection state is untouched. If on-demand parse also yields empty equipment/boardStops (unexpected card layout), logs `logger.error` with `outerHTML.length` and `loadId` for diagnostics, then proceeds to `openPostModal` which will show the user-facing error.

**Fix — `content/patModal.js`** (equipment gate):
Split the `equipment !== "53' Trailer"` branch into two cases:
- `!equipment` (empty string after on-demand parse failed) → `showSimplePatModal("Could not read load data from this card — start the refresh loop once, or report this card layout to the PM.", 'pat-no-equipment')` + `logger.error`.
- non-empty unsupported equipment → existing "not supported yet: «X»" message unchanged.

No change to form logic, payload assembly, patApi.js, or any detection/booking path.

---

### 2026-07-07 — PAT Modal + API rework (LoadFetcher parity, data mapping fixed)

Files changed: `content/patApi.js` (full rewrite), `content/patModal.js` (full rewrite).
Docs updated: `UI_ELEMENTS.md`, `AMAZON_SELECTORS.md`, `BACKLOG.md`, `STATE.md`.

**Reason for rework:** the first implementation (2026-07-06) was confirmed broken by live testing — wrong field names (`payout` vs `payoutNum`), wrong data sources (stop addresses vs `boardStops`), invented equipment labels, missing form fields, and silent markup exposed as a UI label.

All old functions removed: `parseCityState`, `parsePickupDate`, `parseCityStateFromInput`, `wirePatCitySearch`, `CITY_DEBOUNCE_MS`, `resolveEquipmentCode`, `searchCity`, `buildCityInfo`, `buildOrderPayload`, `EQUIPMENT_EXPANSION`, `CITY_SEARCH_PATH`.
Old testids removed: `pat-origin-input`, `pat-dest-input`, `pat-date-input`, `pat-equipment-select`, `pat-markup-note`, `pat-origin-suggestions`, `pat-dest-suggestions`, `pat-city-suggestion`.

No new `.click()` sites. No new manifest permissions. No Amazon DOM interaction. All text via `textContent`.

**patApi.js** (full rewrite — network layer):
- `STATE_NAME_TO_CODE` — full 50+DC table. `normalizeState(s)` — "Florida"→"FL", "FL"→"FL".
- `parseBoardStop(str)` — "JAX9 JACKSONVILLE, Florida 32221" → `{city:"JACKSONVILLE",state:"FL"}`. Drops warehouse code, splits on comma, normalizes state.
- `parsePatStopTime(timeStr)` — "07/10 10:42 EDT" → `{date:Date(UTC), tzName, tzOffset}`. Returns `{tzError}` on unknown TZ; null on unrecognized format. Year rollover if >30 days past.
- `getCsrfToken()` — reads live from `<meta name="x-owp-csrf-token">`, never hardcoded.
- `resolvePATCity(boardStopStr)` — `GET /api/loadboard/filters/cities/search/<city>` (confirmed path). API returns `{name,stateCode,country,latitude,longitude,nearestDomicileCode,displayValue:null}` — `displayValue` is ALWAYS null; built manually as `"${name},${stateCode}"`. Matches by exact name+stateCode, then prefix+stateCode fallback.
- `resolveLoadingType(str)` — "Drop"→["DROP"], "Live"→["LIVE"], "Live/Drop"→["LIVE","DROP"]; null for unknown.
- `buildPatPayload(formState)` — full upsert POST body (confirmed fields from live capture).
- `submitOrder(payload)` — POST to `/api/loadboard/orders/upsert` (confirmed path — earlier draft used invented path `/relay/rlb/api/pat/create-order`, corrected 2026-07-07).

**patModal.js** (full rewrite — UI layer):
- `PAT_TEST_MARKUP_USD = 5000` — silent, no label anywhere. Default payout = `payoutNum + 5000`.
- Equipment gate: only "53' Trailer" shows form; any other equipment → `showSimplePatModal(unsupported notice)`, no form, no network. `logger.warn` with equipment string.
- `makeTimeStepper(timeResult, testidBase)` — [−] [MM/DD HH:mm TZ] [+]; click span → datetime-local input; steps ±15 min. Returns `{el, getDate()}`.
- `openPostModal(loadId)` — async. Modal appears immediately with pre-parsed city name text; then `await Promise.all([resolvePATCity(o), resolvePATCity(d)])` resolves cities in background; guards `overlay.isConnected` before DOM update.
- Confirm disabled until cities resolve + no blocking errors (unknown TZ, unknown loading type).
- $/mi ↔ Payout linked via board distance (not min/max miles). Guard div/0.
- "Exclude Swing Door" checkbox (default checked → `excludeSpecialServices:["SWING_DOOR"]`).
- Success: green "Post created ✓" + modal fade-close after 2.5s. Error: red status, re-enable button.

**Unchanged from original implementation:** `inlinePanel.js` (post button wired correctly), `manifest.json` (load order correct).

---

### 2026-07-06 — Elevation-based dark theme rebuild (nightMode.js)

Files changed: `content/nightMode.js` (full rework), `content/priceSurge.js`.

Styling only — no behavior changes, no new `.click()` sites, no new Amazon selectors.

**Surface ramp** (4 levels, no green):

| Level | Value | Used for |
|---|---|---|
| base | `#16181c` | Page background only |
| raised | `#1e2126` | Load cards, nav header, footer, form inputs, buttons |
| overlay | `#262a31` | Selected card, detail panel, popovers, our inline panel |
| high | `#2e333b` | Stop data rows, segment headers, modal content, expanded rows |

**Text scale**: primary `#e8eaed`, secondary/placeholder `#a8b0b9`, disabled/labels `#6b7480`. Green tint removed from all text values.

**Key changes vs old theme**:
- All green-tinted color constants (`NIGHT_BG`, `NIGHT_CARD`, etc.) replaced with `DK_*` elevation ramp constants.
- Amazon header/banner/nav: was `#1a5c38` (green) → `DK_RAISED` (neutral dark). `NIGHT_HEADER` constant removed.
- Cards: `#1b201d` → `#1e2126` (raised) + `DK_BORDER` hairline each card.
- Selected card: `#2c332e` → `#262a31` (overlay) + strong border.
- Detail sheet: `#161b18` (was DARKER than cards, wrong) → `#262a31` (overlay, correctly elevated above cards).
- Stop rows in detail: `#121714` (near-black) → `#2e333b` (high — readable, elevated from overlay).
- Inline panel: `#161b18` → `#262a31` (overlay — sits at same level as detail sheet against raised card). Added explicit overrides for `.ext-seg-header` (high), `.ext-stop-num` (accent tint), `.ext-seg-loaded` (success), `.ext-seg-empty` (muted), `.ext-route-arrow` (muted), `.ext-action-bar` (overlay), `.ext-action-btn:hover` (high), `.ext-dot-loaded/empty`.
- Footer: was `#151a17` → `DK_RAISED`.
- Text: was `#e7efe9` (green tint) → `#e8eaed` (neutral); disabled labels `rgba(231,239,233,0.32)` → `#6b7480`.

**`content/priceSurge.js`**: Added `!important` to dark-override background (`rgba(212,167,44,.20)`) and badge color (`#f0c040`) — the nightMode.js universal reset was silently winning those properties.

**Uncovered blocks** (no stable selector; inheriting base bg is acceptable):
- Left filter panel: Amazon uses hashed CSS classes; it inherits base bg (`#16181c`) which gives correct base-level reading. No risky selector added.
- Load card `:hover` state: no hover-elevation rule added (risky selector territory). Cards stay raised on hover.

---

### 2026-07-06 — Bug: Sidebar dark mode ignored (root cause: nightMode.js !important override)

Files changed: `content/nightMode.js`, `content/sidebar.js`.

Root cause: `nightMode.js` `buildNightCss()` contained `html.ext-night #ext-sidebar{background-color:#1a5c38 !important}` — the old solid green with `!important`, which overrode the CSS-var-based tokens from `designTokens.js`. Three other stale night-mode values were also present: `.ext-new-load` used an old blue rgba, the pill used the old translucent-on-green rgba, and the scanline used the old green gradient.

- **`content/nightMode.js`** — updated 4 lines in `buildNightCss()`:
  - `.ext-new-load` dark: `rgba(120,180,235,0.20)` → `rgba(76,141,255,.15)` + inset left-rule `rgba(76,141,255,.8)` (matches new accent-bg highlight design)
  - `#ext-sidebar` bg: `#1a5c38 !important` → `#1c1f24 !important` + `color:#e5edf5 !important` (dark neutral surface)
  - `ext-playpause` pill: `rgba(255,255,255,0.15)` → dark neutral `#23272d`, border `#2c313a`, icon `#b0bcca`
  - Scanline gradient: old green `rgba(125,207,142,...)` → blue `rgba(76,141,255,...)`
  - `NIGHT_HEADER = '#1a5c38'` left intact — still used for Amazon's native `<header>`/`[role="banner"]`/`nav` (line 82), which is intentional in the night mode theme.

- **`content/sidebar.js`** — added `html.ext-night #ext-sidebar { … !important }` explicit dark override block (belt-and-suspenders; guards against future nightMode.js injection-order changes). Covers: bar bg/color/border/shadow, title color, pill (default + hover + running states), slider-value color, memory-indicator border, memory-info chip, tooltip bg/color.

Verification: grepping all `*.js` and `*.css` for `#1a5c38`, `rgba(125,207`, `rgba(26,92,56`, `#185FA5`, `rgb(182,227` — only `NIGHT_HEADER` constant remains (Amazon header, expected).

---

### 2026-07-06 — Design system: blue accent tokens, restyled sidebar / popup / inline panel / highlighter / surge

Files changed: `utils/designTokens.js` (new), `popup/popup.css` (full rewrite), `content/sidebar.js`, `content/inlinePanel.js`, `content/highlighter.js`, `content/priceSurge.js`, `popup/popup.js` (night-mode class wiring), `manifest.json`.

Styling only — zero behavior changes. No new `.click()` sites, no DOM structure changes, every `data-testid` preserved.

- **Token layer** (`utils/designTokens.js`, `manifest.json`, `popup/popup.css`): New file injects `<style id="ext-design-tokens">` with all `--ext-*` custom properties on `:root` and `html.ext-night` dark overrides. Listed FIRST in manifest content_scripts. Popup duplicates the token block at top of `popup/popup.css` (separate document — cannot share injected styles).
- **Accent pivot**: green `#1a5c38` → blue `#1a73e8` (dark `#4c8dff`). Green demoted to semantic success only (`--ext-success`). New neutral scale n100–n900.
- **Sidebar** (`content/sidebar.js`): Bar `#1a5c38` → `var(--ext-bar-bg)` (white/dark-surface) + n200 hairline + shadow-2. Title → `var(--ext-n900)`. Pill → n100 fill, n200 border, n700 icon; hover → n200; running state → accent fill + white icon. Slider/scanline → `var(--ext-accent)` (blue). Scanline gradient hardcoded RGB with `html.ext-night` dark override. `prefers-reduced-motion` scoped to `#ext-sidebar`. Memory dot border → n300; info icon → n100/n200/n700; tooltip → n900 bg / bar-bg text. Removed `--ext-scan-dur` declaration (now in token layer). `MEMORY_COLOR_NEUTRAL` → `#8fa1b2` (n400, visible on neutral bar).
- **Popup CSS** (`popup/popup.css`): Full rewrite. Toggles resized 40×24/20px knob (main) and 32×18/14px (small filters). Accent → `var(--ext-accent)`. Title → n900. Section labels → n500 uppercase. Sound block → n100 bg. Replay btn hover → accent. Focus rings → accent outline everywhere.
- **Popup night mode** (`popup/popup.js`): `document.documentElement.classList.toggle('ext-night', ...)` added in storage.get callback and in `onChanged` handler. Only JS change in this task.
- **Inline panel** (`content/inlinePanel.js`): Panel border → n200. Panel bg → `var(--ext-surface)`. Header → accent-bg / accent-text. Seg header → n100 bg, n200 border, n700 text. Route arrow → n400 (neutral, not green). Stop-number circles → accent-bg fill + accent-text (AA 5.5:1). `ext-seg-loaded` → `var(--ext-success)`. Action bar → n100 bg, n200 border. Action btn hover → n200/n900. `flashActionSuccess` SVG stroke `#1a5c38` → `#157347` (correct semantic success).
- **Highlighter** (`content/highlighter.js`): `rgb(182,227,255)` → `var(--ext-accent-bg)` + `box-shadow: inset 4px 0 0 0 var(--ext-accent)` left-rule.
- **Surge** (`content/priceSurge.js`): Green `#1a5c38` → semantic amber `#7a4f00` / `rgba(212,167,44,.12)`. Added `html.ext-night` overrides: `#f0c040` / `.20` opacity. Surge badge remains the one loud non-accent element.

---

### 2026-07-03 — Bug-fix pass: popup / sidebar / priceSurge / constants / storage (6 fixes)

Files changed: `popup/popup.html`, `popup/popup.js`, `content/soundAlert.js`, `content/sidebar.js`, `content/priceSurge.js`, `utils/constants.js`, `utils/storage.js`, `utils/soundDefs.js` (new), `manifest.json`.

- **FIX 1 — Auto-Open Top Load popup toggle** (`popup/popup.html`, `popup/popup.js`): Added `popup-auto-open` checkbox to popup (after Tab Alert row, same pattern). `KEY_AUTO_OPEN = 'autoOpenTopNew'`; loaded with `checked = data[KEY] !== false` (true-default); `onChanged` also uses `!== false`; reset sets `checked = true`. Corresponds to the existing `STORAGE_KEYS.AUTO_OPEN` key already consumed in `content.js`.
- **FIX 2 — Shared sound definitions** (`utils/soundDefs.js` new, `content/soundAlert.js`, `popup/popup.js`, `manifest.json`, `popup/popup.html`): Created `utils/soundDefs.js` exposing a global `var SOUND_DEFS` (25 entries with numbered comments — canonical version from soundAlert.js). Added to manifest content_scripts before `content/soundAlert.js`; added to popup.html before `popup.js`. Deleted `SOUND_DEFS` from `soundAlert.js`; `getSoundTones` now uses the global. Deleted `POPUP_SOUND_DEFS` from `popup.js`; `popupGetSoundTones` now uses the global. Both sound paths now guaranteed identical for the same soundId.
- **FIX 3 — toggleRunning reads tabState, not DOM attribute** (`content/sidebar.js`): `toggleRunning()` changed from `container.getAttribute('data-running') !== 'true'` to `!tabState.get('running')`. The DOM attribute is a *view* of the state (written by `reflectRunning`), not the authoritative source. Race condition: if `reflectRunning` hasn't fired yet, the DOM attribute may be stale. `tabState.get('running')` is always current.
- **FIX 4 — logger discipline in popup.js** (`popup/popup.js`): Replaced three `console.log` calls with `logger.log('popup', ...)` (CLAUDE.md rule 8 — every function must use `logger`): `surgeThreshold loaded`, `surgeEnabled saved`, `surgeThreshold saved`.
- **FIX 5 — clearSurgeHighlights null-parent guard** (`content/priceSurge.js`): `badge.parentNode.removeChild(badge)` wrapped in `if (badge.parentNode)`. A surge badge can be orphaned if Amazon React unmounts the card between the badge insertion and the next `clearSurgeHighlights` call. Null-parent `removeChild` throws a `NotFoundError` that silently kills the rest of the tick's badge-removal loop.
- **FIX 6 — log noise + hardening** (`content/sidebar.js`, `utils/constants.js`, `utils/storage.js`): `updateMemoryIndicator()` entry changed from `logger.log` to `logger.debug` (fires every 7s — too noisy at normal level). `isForbiddenElement()` now guards `el.nodeType !== 1 || typeof el.matches !== 'function'` before `.some()` — prevents TypeError when a text node or comment node is passed (e.g. from a MutationObserver record). `STORAGE_KEYS.SPEED`, `RUNNING`, `PRICE_HISTORY` annotated as legacy (moved to tabState; kept so Reset cleans old installs).

Test cases added: TC-POPUP-1 (auto-open OFF: no card opens), TC-SOUND-1 (popup preview matches in-page alert).

---

### 2026-07-03 — Bug-fix pass: detailOpener / loadParser / panelCloser / refreshManager + content pipeline (5 fixes)

Files changed: `content/content.js`, `content/detailOpener.js`, `content/loadParser.js`, `content/panelCloser.js`, `content/refreshManager.js`.

- **FIX 1 — highest-paying auto-open** (`content/content.js`, `content/detailOpener.js`): Added `sortByPayoutDesc(loads)` helper in `content.js` — returns a copy of the loads array sorted by numeric payout descending; unparseable payouts sort to end (`-Infinity`). `runDetectionPipeline` now sorts `result.newLoads` and `surgeLoads` via `sortByPayoutDesc` before passing to `openTopNewLoad` and `showInlinePanel`; `highlightNewLoads` continues to receive the original unordered array. `detailOpener.js` header comment updated to note that the caller passes payout-sorted loads. This is a behavior change at the existing neutral-zone click site (no new click site added).
- **FIX 2 — detach guard in deferred click** (`content/detailOpener.js`): Added `if (!document.contains(el))` check inside the `setTimeout(250)` callback, before computing `getBoundingClientRect()`. A React remount during the scroll-settle window detaches the card; a detached rect is (0,0) and `elementFromPoint` would click a viewport-corner element. Guard logs a warn and returns without clicking.
- **FIX 3 — nested duplicate card guard** (`content/loadParser.js`): `querySelectorAll` result converted to array; elements contained within another match in the same set are filtered out (`elB.contains(elA)` → drop `elA`). Prevents `.wo-card-header--highlighted` inner headers from producing a duplicate parse with `loadId=null`. Logs `logger.debug` with dropped count when > 0.
- **FIX 4 — panelCloser Strategy 2 less greedy** (`content/panelCloser.js`): Strategy 2 now collects ALL icon-only button candidates (no text, has SVG child) first, then prefers the candidate whose `getBoundingClientRect().top` falls within 80px of the sheet's top (most likely the close button). Falls back to first candidate if none qualify. Logs which strategy path and candidate index were used, plus total candidate count.
- **FIX 5 — stale "ONE allowed click" comments** (`content/refreshManager.js`, `content/detailOpener.js`): Two comment-only changes replacing "the ONE allowed .click() in this project/codebase" with "one of the three allowed Amazon-DOM click sites — see docs/SAFETY.md (canonical)". Comment in `detailOpener.js` header also updated (combined with FIX 1 header update).

Test cases added: TC-OPEN-1 (highest-paying card opened), TC-OPEN-2 (detach guard), TC-PARSE-1 (no null-loadId duplicates).

---

### 2026-07-03 — Bug-fix pass: inlinePanel.js (5 fixes)

File changed: `content/inlinePanel.js`. Docs updated: `docs/AMAZON_SELECTORS.md`, `docs/TEST_CASES.md`.

- **FIX 1 — waitForSheet stale-sheet guard** (`waitForSheet`, `sheetFingerprint`, `initManualToggle`): Added `sheetFingerprint(sheet)` helper (payout text + expander count + first stop label). Before calling `waitForSheet`, `initManualToggle` now captures `prevFingerprint` from the currently open sheet (if any). `waitForSheet(callback, prevFingerprint)` only declares the sheet ready when its fingerprint has changed from `prevFingerprint` — prevents reading the previous card's still-open sheet on the very first 50ms poll. Timeout fallback (1500ms) is unchanged; downstream handles stale reads. Auto-open path is not affected (calls `showInlinePanel` directly, does not go through `waitForSheet`).
- **FIX 2 — currentPanelCard desync between manual and auto paths** (`showInlinePanel`, `removeInlinePanel`, `initManualToggle`): Ownership of `currentPanelCard` moved into `showInlinePanel` (set on successful render) and `removeInlinePanel` (cleared). `initManualToggle` no longer touches the variable. Effect: auto-opened panels now register in `currentPanelCard`, so (a) clicking the auto-opened card once toggle-closes it, and (b) clicking an old card no longer removes a newer card's panel.
- **FIX 3 — global stop numbering breaks for segments with ≠2 stops** (`readSheetData`, `buildPanelElement`): Replaced per-segment formula `baseNum + sn` (broke for 3-stop segments) with a cumulative counter. Boundary stops (first stop of each non-first segment) get `counter - 1` (same as the previous segment's last stop number) without advancing the counter. Verified against documented example: 3×2-stop segments → 1,2/2,3/3,4 (identical output). `buildPanelElement` fallback changed from `stops.length > 1` to `stops.length > 0` for `destNum` — uses actual `stops[].num` whenever any stop exists.
- **FIX 4 — selector-drift alarm for hashed css-XXXX selectors** (`readSheetData`): Two `logger.warn('inlinePanel', 'SELECTOR DRIFT SUSPECTED …')` calls added: (1) when `.load-expander` count is 0 while the sheet exists; (2) when all parsed segments have 0 stops AND empty fromTo (all hashed selectors returned nothing). No behavior change — alarm only.
- **FIX 5 — flashActionSuccess writes string "null" as title** (`flashActionSuccess`): `btn.setAttribute('title', originalTitle)` now guarded: if `originalTitle === null` (button had no title attribute), calls `btn.removeAttribute('title')` instead to avoid writing the literal string `"null"`.

AMAZON_SELECTORS.md: new section "Detail sheet content (inlinePanel readSheetData) ⚠ FRAGILE" listing all hashed selectors with verification date and drift-alarm note.
Test cases added: TC-PANEL-4 (stale-sheet guard), TC-PANEL-5 (auto-open toggle-close + cross-card desync), TC-STOP-3 (3-stop segment numbering).

---

### 2026-07-03 — Bug-fix pass: core loop hardening (7 fixes)

Files changed: `utils/tabState.js`, `content/content.js`, `content/loadObserver.js`, `content/loadParser.js`. No new click sites, no FORBIDDEN_SELECTORS changes.

- **FIX 1 — tabState.set no-op on unchanged value** (`utils/tabState.js`): `set(key, value)` now returns early with a `logger.debug` line when `_state[key] === value` and `key !== 'priceHistory'`. Prevents redundant sessionStorage writes and subscriber notifications (e.g., repeated `running=false` calls no longer re-fire `stopOrchestrator`).
- **FIX 2 — startOrchestrator double-loop race** (`content/content.js`): Added module-level `orchLoopActive` flag. `startOrchestrator()` checks it first and returns with a warn if true; sets it to `true` before firing the first tick. `stopOrchestrator()` clears it. `scheduleNextTick()` bails if `!orchLoopActive`. Prevents a second `running=true` event during an in-flight tick from starting a parallel loop chain.
- **FIX 3 — extract shared detection pipeline** (`content/content.js` + `content/loadObserver.js`): The detect→highlight→sound→tabAlert→auto-open→inline-panel→auto-stop block was verbatim-duplicated. Extracted into `async function runDetectionPipeline(sourceTag)` in `content.js`. `orchestratorTick()` now calls `await runDetectionPipeline('tick')` after refresh+settle. `runObserverPipeline()` calls `await runDetectionPipeline('observer')`. `sourceTag` appears in all log lines so tick vs observer origin is distinguishable. Behavior identical to before.
- **FIX 4 — observer re-arms instead of dropping mutations during a tick** (`content/loadObserver.js`): When `runObserverPipeline` skips because `orchTickRunning` is true, it now re-arms a `setTimeout(runObserverPipeline, OBSERVE_DEBOUNCE_MS)` instead of silently dropping. Module-level `_rearmCount` caps at `MAX_REARMS = 3` consecutive re-arms; resets to 0 on successful run. Prevents DOM changes that arrive mid-tick from being lost.
- **FIX 5 — pruneLoadUnits guard on transient empty parse** (`content/loadParser.js`): `pruneLoadUnits` is now skipped when `results.length === 0`. A transient React remount during a filter change can briefly return 0 cards; the old code would wipe all LoadUnits including Phase 2 detail data. Logs `logger.debug` when skipped.
- **FIX 6 — isExtManagedNode catches inner container nodes** (`content/loadObserver.js`): Added `node.closest('#ext-inline-panel, #ext-sidebar')` check. Icon swaps (e.g., `flashActionSuccess` checkmark replacement) insert child nodes inside our panel without `ext-` IDs; they previously triggered useless observer pipeline passes.
- **FIX 7 — heap log noise** (`content/content.js`): `getHeapUsageRatio()` entry log changed from `logger.log` to `logger.debug`. It fires every 7 s from the sidebar memory-indicator poll, flooding logs at normal level.

Test cases added: TC-LOOP-1 (rapid toggle race), TC-STORE-1 (LoadUnit detail survives transient empty render).

---

### 2026-07-03 — Documentation synchronization pass (MD files only)

Full 9-item consistency pass across all project docs. No code files were changed.

- **Root `CLAUDE.md` deleted** — was the stale two-click-site version. `docs/CLAUDE.md` is now the single source of truth; "Правило завершення задачі" section appended to it.
- **`README.md`** — rewritten to reflect 2026-06-30 reality: 3+1 click sites, popup fully wired, Camera+Map wired, LoadUnit done, memory watchdog replaced by manual indicator.
- **`docs/SPEC.md`** — "20 sounds" → "25 sounds"; "Only two click types" → three Amazon-DOM click types with SAFETY.md reference for the extension-owned memory-indicator click.
- **`STATE.md`** — "Що далі" reduced from 4 contradictory items to 2 clean items (auto-filter restore PLANNED; `_element` audit CLOSED). "Блокери" reduced to 1: the two stale blockers (`_element` GC blocker and `clipboardWrite` not-added-yet blocker) removed.
- **`docs/BACKLOG.md`** — "Hide Similar Matches" marked ✅ DONE; storage key corrected from `'hideSimilar'` to `'hideSimilarMatches'`; `clipboardWrite` removed from Future manifest additions table (feature shipped 2026-06-30).
- **`docs/TEST_CASES.md`** — TC-TAB-5 rewritten (no auto-resume; loop starts paused, speed/threshold restore via tabState.init, dispatcher presses play manually); TC-OBS-5 rewritten (no `ext_resume_after_memory_reload` flag); TC-MEM-1 added (indicator polls while paused, click reloads, tooltip warns about filter loss).
- **`docs/AMAZON_SELECTORS.md`** — stale DIAG-logs paragraph replaced with one-line note: "DIAG logs removed 2026-06-18 after observer behavior was confirmed."
- **`STATE.md`** — "Оновлено" date updated to 2026-07-03; "Що в роботі" updated to reflect docs pass complete.

---

### 2026-06-30 — LoadUnit: unified per-load data model (Steps 1–3)

**New file: `utils/loadStore.js`**

In-memory per-tab load data store (`loadStore` IIFE). Keyed by `loadId` (UUID string).
In-memory only — cleared on any page reload (including dispatcher-triggered
ext-memory-indicator reload). NOT sessionStorage- or chrome.storage.local-backed.
Phase 2 (detail) data is only repopulated when the dispatcher reopens the detail sheet.

Functions exposed as `loadStore.*`:
- `mergeLoadUnit(loadId, patch)` — creates the entry if absent (with `firstSeenAt: Date.now()`),
  then applies the patch. `_element` is always excluded. `detail` and `searchContext` replace
  in full (no recursive merge). `payoutNum` is derived automatically from `patch.payout`.
- `getLoadUnit(loadId)` — returns the LoadUnit or null.
- `pruneLoadUnits(currentLoadIds)` — removes entries for loads no longer on the board; takes
  a `Set<string>` of currently visible loadIds.
- `getAllLoadUnits()` — returns the live internal map by reference; for debugging / future sync.
  Callers must not mutate returned objects.

`window.__EXT_DEBUG.getLoadUnits` exposed for console inspection (same pattern as `getLoads`).

**`manifest.json`** — `utils/loadStore.js` added to content_scripts js array immediately
after `utils/tabState.js` and before `vendor/html2canvas.min.js`, so it is defined before
any content/ module that calls it.

**`content/loadParser.js`** — inside `parseLoads()` for loop, after `results.push(load)`:
calls `loadStore.mergeLoadUnit(load.loadId, phase1Patch)` where `phase1Patch` contains all
ParsedCard fields except `_element`, `detail`, and `searchContext`. `boardStops` is the
renamed mapping of `load.stops` (abbreviated board-level strings, distinct from full
addresses in Phase 2 detail). After the for loop, calls
`loadStore.pruneLoadUnits(new Set(results.map(l => l.loadId).filter(Boolean)))`. Return
value and all external behavior of `parseLoads()` are unchanged — this is purely additive.

**`content/inlinePanel.js`** — in `showInlinePanel()`, after `readSheetData()` succeeds:
resolves `loadId` from `cardElement.querySelector('div[id]').id` (same selector
`parseOneCard` uses) and calls `loadStore.mergeLoadUnit(loadId, { detail: data })`. No
change to panel render path. `showInlinePanel()`'s return value and behavior are unchanged.

**`priceSurge.js`** — NOT touched. Step 4 (migrating `tabState.priceHistory` into
LoadUnit) is explicitly deferred per the approved plan.

**`searchContext`** — stays `null` in every LoadUnit; explicitly not parsed. Slot is
reserved in the schema for when new Amazon selector work is done.

---

### 2026-06-30 — Wire ext-action-map: open Google Maps directions for load route

**`content/inlinePanel.js`:**

- `openRouteInMaps(data)` — collects unique stops in global order by deduplicating on
  `stop.num` (boundary stops appear in both adjacent segments with the same num). Builds a
  Google Maps Directions URL: `origin` = first stop, `destination` = last stop, `waypoints`
  = all intermediate stops joined by `|` (omitted entirely when only 2 stops). Each stop is
  encoded as `stop.name + ' ' + stop.address` (address only if non-empty, else name alone)
  and passed through `encodeURIComponent`. Opens URL via `window.open(url, '_blank',
  'noopener,noreferrer')`. Logs entry + stop count; `logger.warn` when fewer than 2 unique
  stops found.

- `showInlinePanel()` — wires `[data-testid="ext-action-map"]` `addEventListener('click')`
  that calls `openRouteInMaps(data)`. Handler lives here (not in `buildActionBar`) because
  `data` from `readSheetData()` is only in scope in `showInlinePanel`. Extension-owned
  click — no new Amazon DOM interactions.

No new manifest permissions. No new dependencies.

---

### 2026-06-30 — Wire ext-action-camera: screenshot load card → copy PNG to clipboard

**New dependency:** `vendor/html2canvas.min.js` v1.4.1 (~194 KB, vendored local copy —
no CDN, no runtime fetch). Added to `manifest.json` content_scripts js array before all
`content/` scripts. `"clipboardWrite"` added to `manifest.json` permissions (per
BACKLOG.md note — this is the point where it was allowed to land).

**`content/inlinePanel.js`:**

- `flashActionSuccess(btn)` — swaps the camera button to a green checkmark SVG for 1.1 s
  then restores the original innerHTML and title. Pure visual confirmation, no storage.

- `captureCardToClipboard(cardElement, btn)` — calls `html2canvas(cardElement, { scale:
  devicePixelRatio, useCORS:true, allowTaint:false, backgroundColor:'#ffffff',
  logging:false })`, converts the resulting canvas to a PNG blob via `canvas.toBlob()`,
  writes it to the system clipboard via `navigator.clipboard.write([new ClipboardItem(…)])`.
  On success: calls `flashActionSuccess(btn)`. On any error (toBlob null, clipboard write
  rejected, html2canvas rejection): `logger.error()` with context — no uncaught throw, no
  silent no-op.

- `showInlinePanel()` — after `buildPanelElement()` returns, finds `[data-testid=
  "ext-action-camera"]` within the new panel and wires an `addEventListener('click', …)`
  that calls `captureCardToClipboard(cardElement, cameraBtn)`. Handler lives here
  (not in `buildActionBar`) because `cardElement` is only in scope in `showInlinePanel`.
  Extension-owned click, not Amazon DOM — exempt from the 3-click-site rule; documented
  in-code comment.

The capture targets the `cardElement` (div.load-card / div.load-card__selected) only —
the inline panel is a sibling, not a child, so it is never included in the screenshot.
The click on the button is the required user gesture for clipboard write.

---

### 2026-06-30 — Card Action Bar: icon row rendered in inline panel (no functionality yet)

Added a thin icon bar at the bottom of every expanded inline panel (single and
multi-segment). Render-only — no click handlers. Three buttons:

- `ext-action-camera` — camera icon (screenshot placeholder)
- `ext-action-map` — map-pin icon (route map placeholder)
- `ext-action-post` — document+plus icon (create post placeholder)

**`content/inlinePanel.js`:**
- CSS: `.ext-action-bar` (flex row, `border-top`, light grey background) and
  `.ext-action-btn` (28×28, no border, hover tint) added to `injectPanelStyle()`.
- `buildActionBar()` — new function (logger.log at entry); builds the bar and three
  `<button>` elements with inline stroke SVG icons (16×16, static markup, no page data;
  `innerHTML` used only for the static SVG string). Each button has `data-testid`,
  `aria-label`, `title`.
- `buildPanelElement()` — `panel.appendChild(buildActionBar())` added before `return`.

---

### 2026-06-30 — Diagnostic: _element DOM-node retention in knownLoadIds (no code change)

**Finding: non-issue — backlog item closed.**

`knownLoadIds` in `loadDetector.js` is a `Set<string>` (UUID strings only). Every write
is `knownLoadIds.add(load.loadId)` — the string ID, never the full load object or its
`_element`. Load objects with `_element` live only as local variables within each tick
(`validLoads` / `newLoads` in `detectNewLoads()`; `result.newLoads` in
`orchestratorTick()` and the `loadObserver` callback) and go out of scope when the tick
resolves. No detached-DOM-node retention occurs via this path.

Secondary observation: the Set grows unboundedly (IDs added but never evicted), but at
~36 bytes per UUID the accumulation is negligible.

No code change. No DIAG logging added.

---

### 2026-06-30 — Process change: remove mandatory plan-and-wait for routine work (CLAUDE.md)

**Not a code change.** Updated the Communication section in both `CLAUDE.md` and
`docs/CLAUDE.md`:

- **Removed** blanket rules "Before work — short plan, wait for approval" and "Stop after
  each stage, wait for approval".
- **Added** rule 1: routine changes (wiring a UI control, fixing a documented bug,
  applying a fully-specified prompt) proceed directly — report after, not before.
- **Added** rule 2: plan-first + wait for approval is still required for (a) anything
  touching FORBIDDEN_SELECTORS or adding any new `.click()` site (Amazon DOM or
  extension-owned), and (b) prompts that explicitly say "report plan before coding".
- Kept unchanged: bug-reproduction rule, "broke something → say so immediately", all
  "After ANY change" documentation rules, "Before ANY change" read rules.

---

### 2026-06-30 — Wire popup-reset button (Reset to Defaults)

**What:** wired the previously inert `popup-reset` button. Click immediately clears every
extension-managed key from `chrome.storage.local` (all 15 keys in `STORAGE_KEYS`,
including dead legacy keys SPEED/RUNNING/PRICE_HISTORY — harmless no-op for those since
they're no longer written there) and resets all popup UI controls to documented defaults.
No confirm dialog. `tabState` (sessionStorage, per-tab) is intentionally left untouched.

**Restyled:** changed from a prominent full-width green-bordered button to a small, muted
text link (`color:#aaa`, `font-size:11px`, underlined) positioned bottom-left via a new
`.popup-footer` flex wrapper. Becomes slightly darker on hover (`color:#666`). Low
visibility matches its infrequent-use intent.

**Bug fixed (discovered during implementation):** the existing `chrome.storage.onChanged`
listener in `popup.js` assigned `changes[KEY].newValue` directly for `volumeSlider`,
`soundSelect`, and `surgeThreshold`. On a `remove()` call, `newValue` is `undefined` —
this would stomp the reset handler's correct default values, leaving those fields blank.
Fixed: all three assignments now fall back to the documented default when `newValue` is
`undefined` (`70`, `'default'`, `50` respectively).

**Script includes added to popup.html:** `utils/constants.js`, `utils/logger.js`,
`utils/storage.js` (in manifest order, before `popup.js`) — provides `STORAGE_KEYS` for
the exhaustive key list, and `logger` per CLAUDE.md rule 8. `logger.log()` added at the
`DOMContentLoaded` entry point and at reset handler entry + completion.

- **`popup/popup.html`**: 3 script includes; `popup-reset` wrapped in `.popup-footer` div.
- **`popup/popup.css`**: `.popup-reset` restyled as text link; `.popup-footer` added.
- **`popup/popup.js`**: `resetBtn` wired; 3 onChanged lines hardened; `logger.log()` at
  `DOMContentLoaded` entry.

---

### 2026-06-30 — Replace automatic memory-watchdog reload with manual dispatcher-controlled indicator

**Why:** the automatic memory watchdog (`shouldReloadForMemory()`, content.js) called
`location.reload()` on its own once heap usage crossed 500MB/70%. Amazon Relay's search
filters (Origin, Radius, Payout min, Equipment) live only in React state, not the URL, so
the auto-reload silently wiped them with no warning — restoring them would require
simulating clicks on Amazon's own filter controls, which is out of scope per SAFETY.md.
Decision: remove the automatic trigger; let the dispatcher decide when to reload.

**content/content.js:**
- Removed `shouldReloadForMemory()`, `MEMORY_RELOAD_RATIO`, `MEMORY_RELOAD_MIN_BYTES`, the
  auto-reload block in `orchestratorTick()`, and the `ext_resume_after_memory_reload`
  sessionStorage resume-flag (no longer needed — there's no automatic reload to resume
  from, and the dispatcher chose not to auto-resume after a manual reload either).
- Added `getHeapUsageRatio()` — returns `{ usedBytes, limitBytes, ratio }` or `null` if
  `performance.memory` is unavailable. Pure read, no side effects, callable from
  sidebar.js independent of the orchestrator loop's running state.

**content/sidebar.js:**
- New `ext-memory-indicator` (small color-interpolated dot, green ≤40% → amber ~62.5% →
  red ≥85% of heap limit; stops tunable via `MEMORY_INDICATOR_LOW/MID/HIGH` constants).
  Polled every `MEMORY_POLL_MS` (7000ms) via `setInterval`, independent of `tabState.running`
  so it stays live while paused. Click or Enter/Space → `location.reload()` directly —
  dispatcher-initiated only, no automatic trigger anywhere in the extension. Per dispatcher
  decision, the loop does NOT auto-resume after this manual reload.
- New `ext-memory-info` icon — hover (desktop) and tap/focus (touch + keyboard) reveal a
  `textContent`-only tooltip (`ext-memory-tooltip`) explaining the reload and that the
  dispatcher will need to re-enter search filters afterward.

**docs/SAFETY.md:** documented `ext-memory-indicator` as an extension-owned click (our own
UI, not Amazon DOM) in a new "Extension-owned click" section — explicitly NOT added to the
"three click sites" list, since that rule governs Amazon DOM only.

**Out of scope (unchanged):** auto-restoring Amazon's filters after reload — tracked in
BACKLOG.md as a future feature, not started.

- **`content/content.js`**: removed auto-reload watchdog; added `getHeapUsageRatio()`.
- **`content/sidebar.js`**: added `ext-memory-indicator` + `ext-memory-info`.
- **`docs/SAFETY.md`**: documented the new extension-owned click site.

---

### 2026-06-18 — Style left-side stop numbers in segment header rows as blue circles

**Root cause:** `titleSpan` (`.ext-seg-title`, leftmost 40 px column) rendered its origin stop# as plain bold black text. The destination stop# (added in the previous step as a `.ext-stop-num` circle inside `destEl`) was already styled correctly. The two sides were visually mismatched.

**Fix:** three changes, all in `inlinePanel.js`:
1. **CSS `.ext-seg-header .ext-seg-title`** — replaced the plain-text rules (`font-weight:bold;color:#232f3e;text-align:center;padding:0 4px`) with `display:flex;align-items:center;justify-content:center;padding:0`. The span now acts as a flex centering wrapper for the circle inside it.
2. **CSS `.ext-seg-title .ext-stop-num`** — new one-rule override: `margin-right:0`. Cancels the `margin-right:8px` that `.ext-stop-num` normally uses when it precedes text (nothing follows the circle here).
3. **JS `buildPanelElement()`** — replaced `titleSpan.textContent = originNum` with a child `.ext-stop-num` span: same element type, same class, same construction pattern as the destination circle.

Result: both the origin (left column) and destination (inside route cell) now show identical dark-blue circles with white digits. No new CSS values introduced — all values (`#185FA5`, `18px`, `border-radius:50%`, `#fff`, `11px`) come directly from the existing `.ext-stop-num` rule.

- **`content/inlinePanel.js`**: CSS block + `buildPanelElement()`.

---

### 2026-06-18 — Fix global stop numbers in segment header rows

**Root cause:** `titleSpan` in the segment row header used `String(i + 1)` (a loop counter semantically tied to segment position, not global stop order). It happened to equal the origin stop# by coincidence but was not derived from the route data. More importantly, the destination stop had NO number shown in the header row at all — only the code name.

**Fix:** two changes in `buildPanelElement()` (multi-segment branch):
1. `titleSpan.textContent`: now derived from `segment.stops[0].num` (the origin global stop# assigned by `readSheetData()`'s post-processing loop). Falls back to `String(i + 1)` if segment has no parsed stops.
2. `destEl`: instead of `destEl.textContent = destText`, an `.ext-stop-num` circle (same style as the stop-detail table circles) is appended first, containing `segment.stops[last].num`, followed by the destination code text node. Falls back to `String(i + 2)`.

Result for a 3-stop load (2 segments):
- Row 0: `[1]` title | KILN → `[2]` DCM5
- Row 1: `[2]` title | DCM5 → `[3]` CMH1 (shared stop DCM5 = global 2 in both rows)

- **`content/inlinePanel.js`**: `buildPanelElement()` — `titleSpan` derivation + `destEl` circle.

---

### 2026-06-18 — Fix global stop numbers in inline panel stop-detail table

**Root cause:** `parseStopBlock()` always returned `num: ''` (hardcoded empty string). `buildSegmentTable()` gates the `.ext-stop-num` circle span on `if (stop.num)` — since `num` was never assigned, no stop-number circles appeared in the expanded stop table.

**Fix:** added a post-processing loop in `readSheetData()` (after all segments are built, before the route calculation and return). For segment index `N` (0-based), stop at position `k` within the segment receives global number `N+1+k`. This produces the correct shared-stop numbering:
- Segment 0: stops [1, 2]
- Segment 1: stops [2, 3]  ← 2 is shared
- Segment 2: stops [3, 4]  ← 3 is shared

No rendering changes — `buildSegmentTable()` already rendered circles when `stop.num` was truthy.

- **`content/inlinePanel.js`**: added global-stop-number assignment loop in `readSheetData()`.

---

### 2026-06-18 — Remove temporary DIAG logs from loadObserver.js

- **`content/loadObserver.js`**: removed all temporary DIAG logs added during debugging:
  the DOM-snapshot block in `startLoadObserver()`, the per-callback mutation detail log
  (`DIAG callback: fired` with batchSize / target / added / removed class dump), the
  `var m0` binding that existed only to feed those logs. Replaced DIAG-prefixed callback
  status logs with standard operational logs (`mutation: ext-managed change only — ignored`,
  `mutation: not running — ignored`, `mutation: external change — debouncing`).
  All CLAUDE.md-required logs retained: `logger.log()` at each function entry,
  `logger.error()` in catches, standard pipeline result logs.
  File header updated to remove "DIAG logs remain" note.

---

### 2026-06-18 — Fix MutationObserver (attempt 3): broad hasExternalChange filter + _pipelineRunning guard

**Root cause of attempt 2 failure:** `hasLoadCardChange()` matched mutations by specific class names (`'load-card'`, `'load-list'`). Amazon wraps the load-list in React container nodes whose roots have dynamic/hashed class names (`css-xyz`). Those wrapper nodes ARE added to the DOM when the filter changes — but they don't carry `load-card` or `load-list` classes. All four cases in `hasLoadCardChange()` missed them. The observer WAS firing; the filter killed the debounce before it started.

**Fix:** replaced `hasLoadCardChange()` with `hasExternalChange()` — fires for ANY childList mutation that doesn't involve ext-managed nodes, regardless of class names. Amazon's non-load updates are mostly `characterData` or `attribute` mutations which `childList` doesn't observe; the rare non-load `childList` mutation triggers a pipeline pass that calls `detectNewLoads()`, finds `newCount=0`, and exits silently.

Added `_pipelineRunning` boolean guard: prevents two concurrent observer pipeline runs (e.g., Amazon's sheet DOM mutations trigger the observer while the first pipeline is still inside `await sleep(800)`). `orchTickRunning` guard unchanged.

- **`content/loadObserver.js`**: `hasLoadCardChange()` removed; `hasExternalChange()` added (broad, class-name-agnostic). `_pipelineRunning` flag added to `runObserverPipeline()` with `try/finally` reset. DIAG logs unchanged — every callback still logs target/class/running state.

---

### 2026-06-18 — Fix MutationObserver: anchor on document.body to survive container replacement

**Root cause diagnosed:** the observer was bound to `div.load-list` with `subtree:false`. Amazon is a React SPA — changing a filter unmounts the entire `div.load-list` and mounts a fresh one. The old node is detached; an observer on a detached node never fires. The observer went deaf the moment the container was replaced.

**Fix:** anchor on `document.body` (never replaced), observe `{ childList: true, subtree: true }`. Filter every callback with `hasLoadCardChange()` so only load-card or load-list node changes trigger the debounce — Amazon's unrelated UI updates (countdown, breadcrumbs, etc.) are immediately discarded.

- **`content/loadObserver.js`** — complete rewrite:
  - `isExtManagedNode()` updated: now also catches id/data-testid starting with `'ext-'` (covers surge badges with `data-testid="ext-surge-badge"`).
  - `hasLoadCardChange(mutations)` — new filter function. Four cases covered: (1) `mutation.target` is a `div.load-list`; (2) added `div.load-card/load-card__selected`; (3) added/removed `div.load-list` (container replaced); (4) added wrapper contains `div.load-card` or `div.load-list` inside (intermediate parent replaced). Each hit logs a `DIAG` line.
  - `startLoadObserver()` — now observes `document.body` with `{ childList:true, subtree:true }`. Removed `findLoadListContainer()` (no longer needed as the anchor).
  - Observer callback logs every invocation (`DIAG callback: fired`) with batch size, first mutation's target/added/removed class for diagnosis. Logs are intentionally left in until user confirms the fix works.

- **`docs/AMAZON_SELECTORS.md`**: MutationObserver anchor section updated — anchor is now `document.body` with explanation of why `div.load-list` was volatile.

---

### 2026-06-18 — Instant new-load detection via MutationObserver

New `content/loadObserver.js` — supplements the timer tick with a `MutationObserver` on `div.load-list` that runs the existing detection pipeline the moment Amazon's DOM changes (new loads pushed by Amazon, or filter-param change reloads the list). No new `.click()` sites — reuses `openTopNewLoad` neutral-zone click exactly as the tick does.

- **`content/loadObserver.js`** *(new)*:
  - `findLoadListContainer()` → `document.querySelector('div.load-list')` (first, same as parser).
  - `isExtManagedNode(node)` — filters our own `div#ext-inline-panel` insertions (direct child of load-list) and non-element nodes from triggering the pipeline. Prevents infinite observer loop.
  - `runObserverPipeline()` — async. Runs `parseLoads → detectNewLoads → checkPriceSurge → highlightNewLoads → playAlert → flashTabAlert → openTopNewLoad → showInlinePanel → tabState.set('running', false)`. Guards against concurrent tick via `orchTickRunning` flag. Idempotent: `detectNewLoads` diffs against `knownLoadIds`; back-to-back observer+tick pass finds `newCount=0` on the second run — no duplicate alert, no timer reset needed.
  - `startLoadObserver()` — creates observer with `{ childList: true, subtree: false }` and calls `.observe()` on the container. No-op if already active.
  - `stopLoadObserver()` — disconnects observer, cancels pending debounce. Safe to call when inactive.
  - Debounce: 200ms — coalesces burst mutations from filter changes.

- **`content/content.js`**: in `tabState.subscribe('running', fn)` — added `startLoadObserver()` on `val=true`, `stopLoadObserver()` on `val=false`. Added `stopLoadObserver()` before `location.reload()` in memory watchdog path.

- **`manifest.json`**: added `"content/loadObserver.js"` between `"content/panelCloser.js"` and `"content/content.js"`.

---

### 2026-06-18 — Remove filter-panel auto-close; left filter stays open by default

All code that attempted to auto-close the left filter popover on loop start has been removed. Three separate strategies were tried (close-button search, toggle-button click, Escape dispatch + retry) and none worked reliably against Amazon's DOM. The left filter panel is now intentionally left alone — it stays open or closed however the user left it. The right detail-panel auto-close is unchanged and working.

- **`content/panelCloser.js`**: removed `diagFilterPanel()`, `isFilterPanelOpen()`, `findFilterCloseButton()`, `tryCloseFilterPanel()`. `closePanelsForStart()` now contains only the detail-panel close block. File header updated.
- **`utils/constants.js`**: removed `CLOSE_FILTER_PANEL` from `ALLOWED_CLICK_INTENTS`. Comment updated from "Exactly four" to "Exactly three".
- **`docs/SAFETY.md`**: removed Click 3 (filter panel close) section including the Escape fallback note. Click 4 (detail panel) renumbered to Click 3. Counts updated from four to three throughout.
- **`docs/CLAUDE.md`**: rule 4 and safety rule 4 — removed filter-panel close from allowed click list. "Four" → "three".
- **`docs/AMAZON_SELECTORS.md`**: removed entire Filter panel close section. Detail panel close reference updated from Click 4 → Click 3.
- **`docs/UI_ELEMENTS.md`**: panelCloser description updated — filter panel mention removed.

---

### 2026-06-18 — FIX 1 (attempt 3): filter panel close — full diagnostic + retry + Escape fallback

**Why previous attempts failed:** the selector `button[aria-label="Filter"][aria-expanded="true"]` is case-sensitive. Amazon may use a different label casing or may not put `aria-expanded` on the button at all. Also `closePanelsForStart()` fires synchronously on loop start — the popover may not be present in the DOM yet at t=0.

- **`content/panelCloser.js`** — complete rewrite of filter close logic:
  - `diagFilterPanel()` — new diagnostic helper. Logs every `[aria-expanded="true"]` element (tag, aria-label, aria-controls, aria-haspopup, role, id, text) and every `button[aria-label]` containing "filter" (ariaLabel, ariaExpanded, ariaControls, ariaHaspopup, ariaPressed, visible). Runs on every `findFilterCloseButton()` call.
  - `isFilterPanelOpen()` — new helper. Returns true if a filter toggle button with `aria-expanded="true"` is present (case-insensitive), or any `button[aria-expanded="true"]` with "filter" in label, or a visible "Filter…" heading is in the DOM.
  - `findFilterCloseButton()` — enhanced. Strategy 0 now case-insensitive (`button[aria-label="Filter" i][aria-expanded="true"]`). Strategy 0b added: any `button[aria-expanded="true"]` whose aria-label includes "filter" (case-insensitive). Strategies 1–3 unchanged as fallbacks. Calls `diagFilterPanel()` on entry for live logging.
  - `tryCloseFilterPanel(attemptsLeft)` — new retry wrapper. Polls up to 3 times at 250ms intervals (total 750ms, within the 1200ms settle window). If all retries fail and `isFilterPanelOpen()` returns true, dispatches `Escape` keydown on `document.body` as last resort (Amazon React popovers close on Escape).
  - `closePanelsForStart()` — now calls `tryCloseFilterPanel(3)` instead of inline filter close. Detail panel close unchanged.

- **`docs/AMAZON_SELECTORS.md`**: Filter panel close section updated — Strategy 0 now case-insensitive; Strategy 0b added; retry + Escape fallback documented.
- **`docs/SAFETY.md`**: Added note to Click 3 — Escape keydown fallback (not a `.click()`, cannot trigger booking; only dispatched when popover appears open but no button was found after 3 retries).

---

### 2026-06-18 — FIX 1 (attempt 2): filter panel close; FIX 2: manual card open stops loop

- **`content/panelCloser.js`** — FIX 1: `findFilterCloseButton()` — prepended Strategy 0 (primary): `document.querySelector('button[aria-label="Filter"][aria-expanded="true"]')`. The filter control is a toggle button, not a panel with a separate X button — clicking it when `aria-expanded="true"` closes the popover. Existing strategies 1–3 retained as fallbacks for layout changes. No new whitelist entry needed; CLOSE_FILTER_PANEL already covers this.
- **`content/inlinePanel.js`** — FIX 2: `initManualToggle()` — inside the `waitForSheet` callback (toggle-on path), added `tabState.set('running', false)` in its own try/catch before `showInlinePanel`. Fires only when a user manually clicks a load card; the extension's own auto-open path (`openTopNewLoad` → `content.js`) already stops via the same call there. Per-tab only (tabState, not storage.local).
- **`docs/AMAZON_SELECTORS.md`**: updated Filter panel close section — Strategy 0 added as the primary approach (`button[aria-label="Filter"][aria-expanded="true"]`); existing strategies renumbered 1–3.

---

### 2026-06-18 — Auto-close filter + detail panels on loop start

- **`content/panelCloser.js`** *(new)*: `closePanelsForStart()` closes the filter popover and the load-detail sheet (`#selected-work-sheet`) once per loop start by clicking their own close controls. Two new allowed click sites (authorized in SAFETY.md). `findFilterCloseButton()`: 3-strategy search — (1) button with aria-label containing "filter"+"close", (2) panel identified by "Filter…" heading ancestor → button with aria-label "close", (3) icon-only button fallback. `findDetailCloseButton()`: (1) `button[aria-label*="close" i]` inside `#selected-work-sheet`, (2) icon-only button fallback. Every path guarded by `isForbiddenElement()`. Each close wrapped in its own try/catch; logs and skips silently when a panel is not open.
- **`content/content.js`**: added `closePanelsForStart()` call in the `tabState.subscribe('running', fn)` subscriber, before `startOrchestrator()`. Fires once per loop start; does not re-fire while loop is running.
- **`manifest.json`**: `"content/panelCloser.js"` inserted before `"content/content.js"`.
- **`utils/constants.js`**: added `CLOSE_FILTER_PANEL` and `CLOSE_DETAIL_PANEL` to `ALLOWED_CLICK_INTENTS`. Updated comment from "Only these two" to "Exactly four".
- **`docs/SAFETY.md`**: binding boundary updated to four click sites; Click 3 (filter close) and Click 4 (detail close) sections added with rationale, safety argument, gates, and intent constants. Audit checklist updated to name all four sites.
- **`docs/CLAUDE.md`**: rule 4 updated to name all four allowed click sites explicitly.
- **`docs/AMAZON_SELECTORS.md`**: Filter panel close and Detail panel close sections added with selector strategies and re-verify warnings.

---

### 2026-06-18 — Sidebar: remove surge threshold field

- **`content/sidebar.js`**: removed `sidebar-surge-label` span (`↑$`), `sidebar-surge-threshold` number input, the `surgeInput.value` seed line, and the `saveSurgeThreshold` function + its two `addEventListener` calls. Removed the three CSS rule blocks for those two testids (including the webkit spin-button suppression). `tabState.surgeThreshold` logic in `utils/tabState.js` and `content/priceSurge.js` is unchanged — per-tab threshold still works, just no longer exposed in the sidebar UI.

---

### 2026-06-18 — Per-tab state isolation: running, speed, surge threshold, price history

**Problem:** `chrome.storage.local` is shared across all tabs. Auto-stopping in Tab A also stopped Tab B; speed and surge-threshold changes in one tab affected every other tab.

**Solution:** four fields moved out of `chrome.storage.local` into an in-memory + sessionStorage per-tab store (`tabState`). Global settings (nightMode, sounds, tag filters, `surgeEnabled`) are unchanged.

- **`utils/tabState.js`** *(new)*: IIFE exposing `{ init, get, set, subscribe }`. `_state` holds `{ running, refreshIntervalMs, surgeThreshold, priceHistory }`. `set()` updates `_state`, mirrors refreshIntervalMs / surgeThreshold / priceHistory to sessionStorage (running stays memory-only), then calls all synchronous subscribers for that key. `init()` is async: reads sessionStorage for speed/history/threshold; if no threshold in sessionStorage, reads the popup global from `chrome.storage.local[surgeThreshold]` as the default for a new tab, then resolves.

- **`manifest.json`**: added `"utils/tabState.js"` immediately after `"utils/storage.js"` so it is available to all content scripts.

- **`content/sidebar.js`**: removed `async` (no more awaits). Removed both `await storage.get(SPEED/RUNNING, ...)` init reads — replaced with synchronous `tabState.get(...)`. `toggleRunning()` now calls `tabState.set('running', nowRunning)` instead of `storage.set(RUNNING, ...)`; removed direct `reflectRunning()` call (subscriber fires it synchronously). Slider writes `tabState.set('refreshIntervalMs', sec * 1000)` instead of `storage.set(SPEED, ...)`. Removed entire `chrome.storage.onChanged.addListener` block (both RUNNING and SPEED branches). Added `tabState.subscribe('running', reflectRunning)` so the pill flips when the orchestrator auto-stops. Added surge-threshold inline field: `<input type="number" data-testid="sidebar-surge-threshold">`, seeded from `tabState.get('surgeThreshold')`, writes `tabState.set('surgeThreshold', n)` on input/change.

- **`content/content.js`**: removed `chrome.storage.onChanged.addListener` for RUNNING; replaced with `tabState.subscribe('running', fn)` (registered synchronously before the async IIFE). `scheduleNextTick()` made synchronous: reads `tabState.get('running')` and `tabState.get('refreshIntervalMs')` directly. Both auto-stop blocks (new-load + surge) changed from `await storage.set(RUNNING, false); stopOrchestrator()` to `tabState.set('running', false)` — the subscriber calls `stopOrchestrator()` synchronously. Wrapped page-load init in `(async function(){ await tabState.init(); buildSidebar(); initManualToggle(); ... })()` so tabState is seeded before sidebar reads it. Memory-reload resume path changed from `storage.set(RUNNING, true)` to `tabState.set('running', true)`.

- **`content/priceSurge.js`**: removed `SURGE_THRESHOLD` and `PRICE_HISTORY` from `chrome.storage.local.get()` — now only reads `SURGE_ENABLED` from storage. Reads threshold via `tabState.get('surgeThreshold')`. Reads history via `tabState.get('priceHistory')`. Writes rebuilt history via `tabState.set('priceHistory', newHistory)` (synchronous, no await). Resets history on disable via `tabState.set('priceHistory', {})`.

---

### 2026-06-17 — Memory-pressure watchdog: rare auto-reload + resume

- **`content/content.js`**:
  - Added constants: `MEMORY_RELOAD_RATIO = 0.7`, `MEMORY_RELOAD_MIN_BYTES = 500 MB`. Both must be exceeded before a reload is considered (prevents reloads in healthy short sessions).
  - Added `shouldReloadForMemory()`: reads `performance.memory` (guards `undefined` → `false`), logs heap stats (usedMB / limitMB / ratio), returns `true` only when `used >= 500 MB && ratio >= 0.7`. `logger.log` on entry, `logger.error` in catch.
  - At the end of `orchestratorTick` try-block, after the new-load / surge branches: when `result.newCount === 0 && surgeLoads.length === 0` (loop still running, nothing for dispatcher) and `shouldReloadForMemory()` is true → sets `sessionStorage['ext_resume_after_memory_reload'] = '1'` and calls `location.reload()`.
  - Page-load init replaced: reads `sessionStorage['ext_resume_after_memory_reload']`; if `'1'` → removes key, logs, calls `storage.set(RUNNING, true)` (existing `onChanged` listener fires `startOrchestrator()`). Otherwise → existing `RUNNING=false` forced, manual Start required as before.

---

### 2026-06-17 — Price Surge: remove diagnostic code (feature confirmed working)

- **`content/priceSurge.js`**: removed all temporary debug code — per-tick `SURGE-DBG tick:` log, per-load `SURGE-DBG id=...` log, and `window.__EXT_DEBUG.simulateSurge` test hook. No behavior change; surge logic, highlight, badge, sound, and auto-stop remain intact. `grep SURGE-DBG|simulateSurge` → 0 matches.

---

### 2026-06-17 — Price Surge: diagnostics + simulateSurge test hook

- **`content/priceSurge.js`** (debug only — no behavior change):
  - **Part A — per-tick debug log** (marked `// DEBUG: remove later`): logs once per call to `checkPriceSurge` after reading storage — `SURGE-DBG tick: enabled=<bool> historySize=<n> loadsThisTick=<n>`. Shows whether the engine runs, whether surge is enabled, and whether history is populated.
  - **Per-load debug log** widened: previously only logged when `payout !== prev`; now logs for **every load where `prev !== undefined`** regardless of change — `SURGE-DBG id=<loadId> prev=<prev> now=<payout> delta=<delta> thr=<threshold> trig=<bool>`. Makes stable-price ticks visible for confirming loadId stability across refreshes.
  - **Part B — `window.__EXT_DEBUG.simulateSurge(loadId, amount)`**: console-callable test hook. Reads current loads via `parseLoads()`, parses payout, sets `PRICE_HISTORY[loadId] = payout - amount` so the **next orchestrator tick** sees delta = +amount and must trigger if amount >= threshold. Logs loadId, fakePrev, currentPayout, and expected delta to console. Default: first visible load, amount = $100.

---

### 2026-06-16 — Inline panel: center route arrow between equal-width origin/dest halves

- **`content/inlinePanel.js`** (CSS + builder, no behavior change):
  - `.ext-seg-route` grid changed from `150px 1fr` (fixed-left) to `1fr auto 1fr` (symmetric). Arrow column is `auto` (glyph width only), so origin and destination halves are always equal regardless of text length. Arrow stays centered at all times.
  - `.ext-route-origin`: `text-align` changed from `right` to `center`; `min-width:0` kept so the cell can shrink. Text wraps within its half.
  - `.ext-route-dest`: added `overflow-wrap:break-word; word-break:break-word; min-width:0; text-align:center` — previously had none of these.
  - `.ext-route-right` wrapper removed from both CSS and JS. Arrow and destination are now direct children of `.ext-seg-route`, sitting in columns 2 and 3 of the 3-column grid.
  - Arrow margin tightened from `0 0.45em` to `0 0.35em` (less gap against the tighter `auto` column).

---

### 2026-06-16 — Tag filters: add "Booked before" toggle + fix leftover space (display:none + wrapper collapse)

- **`utils/storage.js`**: added `HIDE_PAST_BOOK: 'hidePastBook'`.
- **`content/filterTags.js`**:
  - Added 4th tag state: `pastBook`. Queries `[id="PAST_BOOK"]` via `querySelectorAll`, never `getElementById`.
  - **Bug fix — leftover space**: changed all tag hiding from `visibility:hidden` to `display:none`, so the tag element's space collapses entirely.
  - **Wrapper collapse**: new `recomputeWrappers()` — after hiding individual tags, iterates every `.wo-tag` wrapper. If ALL its known tag children (`[id="PROMOTED"]`, `[id="STARTING_SOON"]`, `[id="TRAILER_READY"]`, `[id="PAST_BOOK"]`) are `display:none`, the wrapper itself is set to `display:none` to remove the remaining gap. Restores `display:''` when any child becomes visible again. Wrappers with no known tag children are never touched.
  - Observer and `anyOn` guard updated to include `pastBook`.
- **`popup/popup.html`**: 4th toggle "Booked before" added to `.popup-tag-block`; `id="popup-hide-past-book"`, `data-testid="popup-hide-past-book"`. No inline handlers.
- **`popup/popup.css`**: `.popup-tag-block` gap reduced from `6px` to `4px` to accommodate 4 items cleanly.
- **`popup/popup.js`**: `KEY_HIDE_PAST_BOOK`, element ref, load-on-open, `addEventListener('change')`, `onChanged` entry — wired identically to the other three tag toggles.

---

### 2026-06-16 — Price Surge: price-only highlight + auto-stop + open details

- **`content/priceSurge.js`**:
  - Removed full-card `.ext-surge-load` yellow background. Now highlights only the payout element: `.ext-surge-price` (green text + subtle green tint on `.wo-total_payout`). Injects a sibling badge span (`'↑ +$' + Math.round(delta)`) via `textContent` with `data-testid="ext-surge-badge"`. `clearSurgeHighlights()` removes both the class and every `[data-testid="ext-surge-badge"]` badge so stale badges never accumulate.
  - `checkPriceSurge` now **returns** an array of surge load objects (the full load, including `_element`). `priceSurge.js` itself never calls `.click()`.
- **`content/content.js`**: captures `surgeLoads = await checkPriceSurge(loads)`. Added `else if (surgeLoads.length > 0)` branch that mirrors the new-load auto-stop pattern exactly: `openTopNewLoad(surgeLoads)` (existing neutral-zone click — no new `.click()` sites), `sleep(800)`, `showInlinePanel`, then `storage.set(RUNNING, false)` + `stopOrchestrator()`. Surge branch only fires when `result.newCount === 0` (new loads take priority).

---

### 2026-06-16 — Price Surge Alert: implement + fix persistence bug

- **Root cause of persistence bug:** `popup-surge` and `popup-surge-threshold` were completely absent from `popup.js` — no key constants, no element refs, not in the storage read, no write handlers, not in the `onChanged` listener. The HTML `value="50"` attribute was the only source of truth, causing the field to revert on every popup open.
- **`utils/storage.js`**: added `SURGE_ENABLED: 'surgeEnabled'`, `SURGE_THRESHOLD: 'surgeThreshold'`, `PRICE_HISTORY: 'priceHistory'` to `STORAGE_KEYS`.
- **`popup/popup.js`**: wired `popup-surge` and `popup-surge-threshold` following the same pattern as all other controls — key constants, element refs, included in `chrome.storage.local.get([...])`, load callback, write handlers (`addEventListener` on `'input'`+`'change'` for threshold, `'change'` for toggle; invalid/NaN values silently skipped without overwriting), `onChanged` live-sync. `console.log` on both load and save paths for console verification.
- **`content/priceSurge.js`** (new): `checkPriceSurge(loads)` — single storage read per tick (`SURGE_ENABLED`, `SURGE_THRESHOLD`, `PRICE_HISTORY`); if disabled clears highlights and resets `PRICE_HISTORY` to `{}`; builds `newHistory` from scratch each tick (auto-purges gone loads); triggers only on payout increases `>= threshold`; applies `.ext-surge-load` (amber `rgb(255,214,102)`) via `classList`; calls `playAlert()` on new surge cards. DEBUG log on any payout change (any direction) for verification. Style injection idempotent by `<style id="ext-surge-style">`.
- **`content/content.js`**: `await checkPriceSurge(loads)` inserted after `detectNewLoads(loads)`, before the new-load branch — runs every tick unconditionally.
- **`manifest.json`**: `content/priceSurge.js` added after `soundAlert.js` (needs `playAlert`) and before `content.js`.

---

### 2026-06-16 — Inline panel: right-align origin in route cell

- **`content/inlinePanel.js`** (CSS only): added `text-align:right` to `.ext-route-origin`. Origin text is now flush against the arrow on its right edge; arrows stay in the same vertical column; outer columns unaffected.

---

### 2026-06-16 — Inline panel: remove status/action badges + align route arrows

- **`content/inlinePanel.js`** (CSS + builder, no data/logic change):
  - **Status column** (Loaded/Empty): removed `.ext-badge-loaded` / `.ext-badge-empty` pill rules. Now plain text directly on `.ext-seg-status` span. Green `#1a5c38` / bold for Loaded (`.ext-seg-loaded`), muted `#878787` for Empty (`.ext-seg-empty`).
  - **Action column** (Drop/Live/Preloaded): removed `.ext-badge-action` pill rule. Plain text directly on `.ext-seg-action` span, muted `#565959`.
  - **Route arrows aligned**: `.ext-seg-route` converted from inline-flow to inner 2-column grid `150px 1fr`. Origin occupies the fixed 150px column; a new `.ext-route-right` wrapper spans `[arrow + destination]` in the remaining `1fr` column. All arrows now stack in a single vertical column regardless of origin length. `min-width:0` on both sub-columns keeps the outer grid unaffected.

---

### 2026-06-16 — Inline panel: visual redesign of segment-header rows

- **`content/inlinePanel.js`** (CSS + builder, no data/logic change):
  - **Grid**: `40px minmax(0,3fr) 1.4fr 1fr 1fr 32px` (wider route column, fuller width). Vertical padding increased to 10px for better readability.
  - **Route connector**: `fromToSpan` is now three separate DOM nodes — `.ext-route-origin` + `.ext-route-arrow` + `.ext-route-dest` — all set via `textContent`, no innerHTML. Origin and destination render in a monospace stack (`ui-monospace,"SF Mono",Menlo,Consolas,monospace` 11px) for readable IDs. Arrow `→` is bold, 1.15em, `#1a5c38` accent — clearly visible separator between endpoints.
  - **Distance·time**: `.ext-seg-dist` — muted `#878787`, 11px, centered, so it recedes behind the route.
  - **Badges**: "Loaded" → `.ext-badge-loaded` (filled `#1a5c38` green pill); "Empty" → `.ext-badge-empty` (muted outline pill); Drop/Live/Preloaded → `.ext-badge-action` (neutral `#e8edf0` grey pill). Each badge sits inside a `.ext-seg-action` / `.ext-seg-status` wrapper cell for independent CSS targeting and `text-align:center`.
  - Action span always emitted (grid slot kept); badge only rendered when `loadType` is non-empty.

---

### 2026-06-16 — Inline panel: fix segment-header column alignment

- **`content/inlinePanel.js`** (CSS + builder only, no data/logic change):
  - `.ext-seg-header`: changed from `display:flex; justify-content:space-between` to `display:grid; grid-template-columns:32px minmax(0,2.2fr) 1.2fr 1fr 1fr 28px` — 6 fixed columns matching the 6 rendered fields (number / route / dist·time / action / status / arrow). Column edges now align identically across all segment rows.
  - Added `.ext-seg-route{min-width:0; overflow-wrap:break-word; word-break:break-word}` — route text wraps inside column 2 instead of overflowing or truncating. Rows may be taller when route is long; column alignment is unaffected.
  - `.ext-seg-title` and `.ext-seg-arrow` gain `text-align:center` and tighter padding (`0 4px`) to match their fixed 32/28 px columns.
  - `buildPanelElement`: `loadTypeSpan` is now always emitted (empty string when absent) so all 6 grid columns are always present. Previously the span was conditional, which collapsed the grid and shifted later columns.

---

### 2026-06-15 — Step 3: Tag filters — hide badge only (not the card)

- **`content/filterTags.js`:** changed hiding strategy from `card.style.display = 'none'` to `tagEl.style.visibility = 'hidden'` on the tag element itself. Cards stay fully visible and clickable; only the purple badge is hidden. `recomputeTagHiding()` now queries each tag id directly (`[id="PROMOTED"]` etc.) and sets `visibility` per toggle state — no card-root traversal. Restores `visibility = ''` when toggled off.
- **`content/loadDetector.js`:** reverted the `offsetParent === null` exclusion added in the previous step — it was needed only while cards were `display:none`. All cards now participate in new-load detection normally.

---

### 2026-06-15 — Step 3: Hide tag filters (Promoted / Starting soon / Trailer ready)

- **`utils/storage.js`:** added `HIDE_PROMOTED: 'hidePromoted'`, `HIDE_STARTING_SOON: 'hideStartingSoon'`, `HIDE_TRAILER_READY: 'hideTrailerReady'` (all boolean, default false).
- **`content/filterTags.js`** (new): `recomputeTagHiding()` iterates all card roots (`div.load-card, div.load-card__selected, div.wo-card-header--highlighted`), checks each for `[id="PROMOTED"]` / `[id="STARTING_SOON"]` / `[id="TRAILER_READY"]` descendants, sets `card.style.display = 'none'` or `''`. Uses `querySelectorAll` (never `getElementById`) because Amazon duplicates these ids across cards. `MutationObserver` active only while ≥1 toggle is on; disconnects when all off. `applyTagHiding()` called on init (reads storage) and on `chrome.storage.onChanged`. No `.click()`, no innerHTML.
- **`content/loadDetector.js`:** `detectNewLoads()` filter now also excludes loads where `load._element.offsetParent === null` — hidden cards (display:none or ancestor hidden) are never detected as new, never highlighted, never trigger sound or auto-open.
- **`popup/popup.html`:** replaced single "Hide Promoted & Starting Soon" row with `.popup-tag-block` — three compact columns, each with a small label (`Promoted` / `Starting soon` / `Trailer ready`) and a small toggle (`toggle-switch--sm`). ids: `popup-hide-promoted`, `popup-hide-starting-soon`, `popup-hide-trailer-ready`.
- **`popup/popup.css`:** added `.popup-tag-block`, `.popup-tag-filter`, `.popup-tag-label`, `.toggle-switch--sm` (30×16 px variant with 10 px dot and 14 px translate).
- **`popup/popup.js`:** three new key vars; all three read on popup open, written on `change`, synced via `chrome.storage.onChanged`. Updated WIRED/NOT-WIRED comment.
- **`manifest.json`:** `content/filterTags.js` inserted after `content/filterSimilar.js`.

---

### 2026-06-15 — Step 3: Sound block — expanded to 25 sounds

- **`content/soundAlert.js`:** replaced 3-branch if-else with `SOUND_DEFS` dispatch table (25 entries). Added `freqEnd` support to `playSoundConfig`: if a tone descriptor has `freqEnd`, oscillator frequency ramps linearly from `freq` to `freqEnd` over the tone duration using `setValueAtTime` + `linearRampToValueAtTime`. `getSoundTones()` now delegates to `SOUND_DEFS[soundId] || SOUND_DEFS['default']`. New sounds: bell, deep, high, click, ding, sonar, low, blip, wood, double, notify, drop, triple, alarm, fanfare, sparkle, sweep_up, sweep_down, chord, dial, burst, error.
- **`popup/popup.html`:** `<select id="popup-sound-select">` expanded from 3 to 25 `<option>` elements.
- **`popup/popup.js`:** `popupGetSoundTones()` replaced with `POPUP_SOUND_DEFS` dispatch table (identical 25 configs). `previewSound()` updated to handle `freqEnd` the same way as `playSoundConfig`.

---

### 2026-06-11 — Step 3: Sound block wired (persistence + preview)

- **`utils/storage.js`:** removed `SOUND_MUTED: 'soundMuted'`; added `VOLUME: 'soundVolume'` (number 0–100, default 70) and `SOUND_ID: 'soundId'` (string, default `'default'`).
- **`content/soundAlert.js`:** refactored. `getSoundTones(soundId, startTime)` — pure function, returns tone descriptors for `'default'` / `'soft'` / `'sharp'`. `playSoundConfig(soundId, gainPeak)` — async, resumes AudioContext, schedules oscillators. `playAlert()` — reads `VOLUME` + `SOUND_ID` from storage; returns early if `VOLUME === 0`; scales gain as `VOLUME / 100`. No more `SOUND_MUTED`.
- **`popup/popup.html`:** wrapped `<select>` and new replay `<button>` in `.popup-sound-select-row` div. New element: `id="popup-sound-replay"`, `data-testid="popup-sound-replay"`, `aria-label="Preview sound"`.
- **`popup/popup.css`:** added `.popup-sound-select-row` (flex row) and `.popup-sound-replay` (28×28 px icon button, green on hover) styles.
- **`popup/popup.js`:** Sound block fully wired. On open: reads `soundVolume` + `soundId` from storage, sets slider and dropdown (defaults: 70 / `'default'`). Slider writes on `change` (released, not every `input`). Dropdown writes on `change` then plays preview. Replay button plays preview of current selection at current volume. `previewSound(soundId, volume)` — mirrors `soundAlert.js` configs exactly (same `getSoundTones` logic) using a popup-local `AudioContext`. Live sync via `chrome.storage.onChanged`.

---

### 2026-06-11 — Step 3: Tab Alert wired

- **`utils/storage.js`:** added `TAB_ALERT: 'tabAlert'` to `STORAGE_KEYS`.
- **`content/tabAlert.js`** (new): `flashTabAlert()` — async, reads `STORAGE_KEYS.TAB_ALERT`; if enabled, swaps favicon to an orange "!" canvas icon and blinks the document title with "🔔 " prefix at 750 ms intervals for 10 s total. `stopTabAlert()` restores title and favicon; called automatically on `visibilitychange` (user focuses tab) or after duration. Both functions exposed on `window.__EXT_DEBUG`. No `.click()` calls.
- **`manifest.json`:** `content/tabAlert.js` inserted after `content/soundAlert.js`, before `content/detailOpener.js`.
- **`content/content.js`:** `flashTabAlert()` called in `orchestratorTick()` after `playAlert()` when new loads are found (`result.newCount > 0` branch). Not awaited — fire-and-forget is fine since the blink runs on its own timer.
- **`popup/popup.js`:** Tab Alert toggle wired alongside Night Mode. Reads `tabAlert` on DOMContentLoaded, writes on `change`, synced live via `chrome.storage.onChanged`.

---

### 2026-06-11 — Step 3: Night Mode wired (clean implementation)

- **`utils/storage.js`:** added `NIGHT_MODE: 'nightMode'` to `STORAGE_KEYS`.
- **`content/nightMode.js`** (new): CSS-class-toggle approach — `ensureNightStyle()` injects `<style id="ext-night-mode-style">` once (idempotent); `applyNightMode(on)` toggles `html.ext-night` class. All dark rules are scoped to `html.ext-night`, so toggling off instantly reverts to Amazon's original styles. Header preserved via `header, [role="banner"], nav[role="navigation"]` forced back to `#1a5c38`. Own sidebar (`#ext-sidebar`) and inline panel (`#ext-inline-panel`) re-asserted to their original colours at high specificity. `initNightMode()` reads storage on load; `chrome.storage.onChanged` keeps it live. `window.__EXT_DEBUG.toggleNight` exposed for console testing. No `.click()` calls.
- **`manifest.json`:** `content/nightMode.js` inserted after `utils/storage.js`, before `content/refreshManager.js`.
- **`popup/popup.js`:** Night Mode toggle wired — reads `nightMode` on DOMContentLoaded, writes on `change`, stays live via `chrome.storage.onChanged`. All other controls remain unwired.

---

### 2026-06-11 — Night Mode wiring fully reverted

Night Mode went through four CSS iterations (per-selector overrides → root invert → invert + tweaks → direct color overrides) but all had live-site conflicts (Amazon top header colour, invert side-effects). Entire Night Mode wiring reverted to UI-BUILT state pending a clean reimplementation.

- **Deleted:** `content/nightMode.js`
- **`manifest.json`:** removed `content/nightMode.js` from `content_scripts.js` array
- **`utils/storage.js`:** removed `NIGHT_MODE: 'nightMode'` from `STORAGE_KEYS`
- **`popup/popup.js`:** restored to intentionally inert (no DOMContentLoaded, no storage access)
- **`docs/UI_ELEMENTS.md`:** `popup-night-mode` status reverted to NOT wired
- **`docs/BACKLOG.md`:** Night Mode reverted from DONE → UI-BUILT; note added on correct approach (direct color overrides, not invert())

---

### Session 2026-06-11 — Sidebar redesign + Popup redesign + Bug fixes

#### content/sidebar.js — play/pause + scanline
- Removed: old `ext-btn-toggle` text button (Start / Stop).
- Added: `ext-playpause` pill control (SVG play ↔ pause icons). Visual state driven entirely by `container[data-running]` attribute + CSS selectors — no JS toggling class names. Click calls `toggleRunning()` which writes `STORAGE_KEYS.RUNNING` to storage (single source of truth). Keyboard: Enter / Space.
- Added: `ext-scanline` div at bottom edge of bar. CSS-only animation (`extScan` keyframe) runs while `container[data-running="true"]`. Speed linked to refresh interval via CSS custom property `--ext-scan-dur` set by `applyScanSpeed(speedSec)` (formula: `speedSec * 0.7`, clamped 0.5s..4s). `prefers-reduced-motion` disables animation.
- Added: `applyScanSpeed()` helper called on slider input AND on `chrome.storage.onChanged` for `STORAGE_KEYS.SPEED` (popup or other source changes speed → scanline updates live).
- `chrome.storage.onChanged` listener now handles both `STORAGE_KEYS.RUNNING` and `STORAGE_KEYS.SPEED`.

#### popup/popup.html + popup/popup.css + popup/popup.js — full redesign (UI only)
- Removed from popup: "Active" toggle, refresh-speed slider, "Loads visible" / "Last refresh" status fields. Run/speed control lives only in the sidebar now.
- New popup layout — two sections: **Display & Alerts** and **Load Board Filters**.
- Display & Alerts controls (UI built, NOT wired): Night Mode toggle, Tab Alert toggle, Sound block (volume slider + sound selector dropdown), Price Surge Alert toggle + threshold number input.
- Load Board Filters controls (UI built, NOT wired): Hide Promoted & Starting Soon toggle, Hide Similar Matches toggle.
- Footer: Reset to defaults button (NOT wired).
- `popup.js` is intentionally inert — no DOMContentLoaded handler, no storage access. Placeholder for Step 3 wiring.

#### content/detailOpener.js — scroll-before-click fix
- Bug: `elementFromPoint` returned null for new loads scrolled below the viewport (y > window.innerHeight). Fix: call `el.scrollIntoView({ block: 'center' })` (try/catch) after all three gates pass, then defer the point-resolve + click to `setTimeout(..., 250)`. Return true optimistically after scheduling. All safety checks (null, isForbiddenElement, el.contains fallback) run inside the timeout with the post-scroll rect.

#### content/detailOpener.js — earlier fix (same session)
- Replaced `dispatchRealisticClick` synthetic event sequence with `document.elementFromPoint` approach. Point biased left (30% width, 50% height) to avoid the Book button. Two additional safety gates on resolved target.

#### content/inlinePanel.js — multiple fixes and features
- `readSheetData` returns `{ header, segments }` (segmented model). Segments parsed from `.load-expander` blocks.
- Equipment text: regex `/\d+'\s*Trailer/` on normalized `.css-1cbogyo` text. Load type (Live/Drop/Preloaded): regex `Trailer\s+(Live|Drop|Preloaded)/i` on same block. Both set in one pass.
- Per-segment stop dedup by `arrival|departure` time key (fresh `seen` object per segment). Stops with missing times always kept.
- `buildPanelElement`: single-segment loads render the table directly (no accordion); two+ segments get collapsible grey headers (collapsed by default).
- Added `waitForSheet(callback)`: polls every 50ms (max 1500ms) until `#selected-work-sheet` contains `.load-expander`, then fires callback. Used by `initManualToggle` instead of fixed 800ms timeout.
- Added `initManualToggle()`: document-level click listener (bubbling); clicks on `.load-card` / `.load-card__selected` trigger `waitForSheet` → `showInlinePanel`. Clicking the same card again removes the panel (toggle off). `isForbiddenElement` guard on `ev.target`. Double-init guard via `window.__extManualToggleInit`. NOT auto-called from this file.
- `currentPanelCard` module-level variable tracks which card owns the current panel.
- CSS: `table-layout:fixed`, column widths 40/20/20/20%, `word-break:break-word`. Scanline gap removed (`margin: 0 0 12px 0`). Segment header uses `justify-content:space-between`, no `margin-left:auto` on arrow.

#### content/content.js — wiring + orchestrator fixes
- `initManualToggle()` called after `buildSidebar()` on page load.
- `startOrchestrator()` now fires `orchestratorTick().then(scheduleNextTick)` — first tick is immediate on Start, no initial delay.
- After new loads found: `openTopNewLoad` return value captured; if `autoOpen && opened`, `sleep(800)` then `showInlinePanel(result.newLoads[0]._element)` in try/catch. Auto-stop (storage.set RUNNING false + stopOrchestrator) happens AFTER the panel renders.

#### content/loadParser.js — green-highlight cards fix
- `parseLoads()` selector updated to: `div.load-card, div.load-card__selected, div.wo-card-header--highlighted`. Amazon highlights new loads with `wo-card-header--highlighted` before the user clicks them; without this fix they were invisible to the detector.

#### content/highlighter.js — match Amazon's highlight color
- `.ext-new-load` rule changed to `background-color: rgb(182, 227, 255) !important` (matches Amazon's own new-load highlight). Outline/box-shadow removed.

#### manifest.json
- `content/inlinePanel.js` added to `js` array after `detailOpener.js`, before `sidebar.js`.

---

### Stage 13 fix — 2026-06-09
- Updated: content/detailOpener.js — replaced el.click() with dispatchRealisticClick(el); fires pointerdown→mousedown→mouseup→click via dispatchEvent so Amazon's React handler sees a full synthetic event sequence; all 3 gates + FORBIDDEN guard unchanged; return values unchanged

### Stage 13.5 fix — 2026-06-04
- Updated: content/content.js — page load now forces RUNNING=false (no auto-start); orchestratorTick new-loads branch now calls storage.set(RUNNING,false)+stopOrchestrator() after highlight/sound/open, flipping sidebar+popup toggle back via onChanged

### Stage 13.5 — 2026-06-04
- Updated: utils/storage.js — added STORAGE_KEYS.AUTO_OPEN = 'autoOpenTopNew'
- Updated: content/content.js — added orchestrator: orchTimer/orchTickRunning state, sleep(), orchestratorTick() (refresh → settle → parse → diff → highlight+sound+open if new), scheduleNextTick() (reads RUNNING+SPEED, self-reschedules via setTimeout), startOrchestrator()/stopOrchestrator(); chrome.storage.onChanged listener wires RUNNING toggle; restores running state on page load

### Stage 13 — 2026-06-04
- Added: content/detailOpener.js — openTopNewLoad(newLoads): 4-gate safety check (existence, isForbiddenElement, DOM membership), NEUTRAL_ZONE intent log, ONE el.click() on card body; __EXT_DEBUG.openTopNew exposed; NOT wired to refresh loop
- Updated: manifest.json — content/detailOpener.js added after soundAlert.js, before sidebar.js
- Updated: docs/SAFETY.md — "Sole .click()" section updated to record both click sites (refreshNow + openTopNewLoad)

### Stage 12 — 2026-06-04
- Added: content/soundAlert.js — lazy AudioContext; playAlert(): checks SOUND_MUTED, resumes suspended ctx, plays 880Hz+1100Hz two-tone beep via OscillatorNode+GainNode, try/catch; __EXT_DEBUG.playAlert exposed; NO clicks, NOT wired to detector
- Updated: utils/storage.js — added STORAGE_KEYS.SOUND_MUTED = 'soundMuted'
- Updated: manifest.json — content/soundAlert.js added after highlighter.js, before sidebar.js

### Stage 11.5 fix — 2026-06-04
- Updated: content/loadParser.js — parseLoads() now scopes to first div.load-list only (main results); "Similar matches" second list ignored; parseOneCard() unchanged

### Stage 11 — 2026-06-04
- Added: content/highlighter.js — injectHighlightStyle() (once, guarded by id); highlightNewLoads(newLoads): adds .ext-new-load class; clearHighlights(): removes from all matching elements; __EXT_DEBUG.highlightNew + clearHighlights exposed; NO clicks, NOT wired to refresh loop
- Updated: manifest.json — content/highlighter.js added after loadDetector.js, before sidebar.js

### Stage 10 — 2026-06-04
- Added: content/loadDetector.js — detectNewLoads(loads): Set-based diff, first-run seeding (returns empty on first call), skips null loadIds; resetKnownLoads(); __EXT_DEBUG.detectNewLoads + resetKnownLoads exposed; NO clicks, NO highlighting, NOT wired to refresh loop
- Updated: manifest.json — content/loadDetector.js added after loadParser.js, before sidebar.js

### Stage 9 fix — 2026-06-04
- Updated: utils/storage.js — added STORAGE_KEYS.RUNNING = 'isRunning'
- Updated: content/sidebar.js — restores running state from storage on init; toggle click persists STORAGE_KEYS.RUNNING; sidebar and popup now fully in sync via storage
- Updated: popup/popup.js — comment updated confirming KEY_RUNNING literal matches STORAGE_KEYS.RUNNING; no logic change needed

### Stage 9 — 2026-06-04
- Added: popup/popup.html — CSP-safe (no inline scripts), links popup.css + popup.js
- Added: popup/popup.css — 320px wide, green toggle switch, slider, status section
- Added: popup/popup.js — reads/writes chrome.storage.local directly (isolated context); toggle writes isRunning; slider writes refreshSpeedSeconds; chrome.storage.onChanged keeps UI live; NO .click(), NO parsing
- Updated: manifest.json — action.default_popup set to popup/popup.html
- Updated: docs/UI_ELEMENTS.md — replaced placeholder popup entries with actual Stage 9 elements

### Stage 8 — 2026-06-02
- Added: content/loadParser.js — parseOneCard() + parseLoads(); Layout A only (div.load-card / load-card__selected); parses loadId, payout, pricePerMile, distance, duration, stops, equipment, trailerLetter, loadingType, deadhead, tag, specialServices, _element; per-card try/catch; __EXT_DEBUG.getLoads exposed; NO .click(), NO auto-run
- Updated: manifest.json — content/loadParser.js added after refreshManager.js, before sidebar.js
- Updated: docs/AMAZON_SELECTORS.md — expanded Load card (Layout A) section with all verified field selectors and strategies

### Stage 8-pre — 2026-06-02
- Updated: utils/constants.js — added '#book-btn-row' to FORBIDDEN_SELECTORS (Layout B/Contracts Book button; out of scope but guarded); isForbiddenElement() logic unchanged; array now has 3 selectors
- Updated: docs/AMAZON_SELECTORS.md — added #book-btn-row to Booking FORBIDDEN section with out-of-scope note; marked Layout B/Contracts as intentionally ignored with explanation
- Updated: docs/SPEC.md — added "MVP scope: Load Board only" section; clarified feature #2 as Layout A only; added Contracts/Block/Layout B to Non-goals

### Stage 7 — 2026-06-02
- Updated: content/refreshManager.js — added refreshNow(): isForbiddenElement guard + tagName==='BUTTON' check + the ONE button.click() in the codebase; exposed __EXT_DEBUG.refreshNow; findRefreshButton and refreshDryRun unchanged
- Updated: docs/SAFETY.md — recorded refreshNow() as sole .click() call site, listed all 3 required gates; updated audit checklist

### Stage 6 — 2026-06-02
- Added: content/refreshManager.js — findRefreshButton() (2-strategy fallback chain, NO .click()); refreshDryRun() (finds, logs, isForbiddenElement check, NO .click()); __EXT_DEBUG.refreshDryRun exposed for manual console testing only
- Updated: manifest.json — content/refreshManager.js added after storage.js, before sidebar.js
- Updated: docs/AMAZON_SELECTORS.md — replaced Refresh button TODO with verified fallback chain strategy (strategy 1: "Next Refresh" text → parent → button; strategy 2: SVG path d-attribute → .closest('button'))

### Stage 5 — 2026-06-02
- Added: utils/storage.js — storage object with async get/set/remove/getAll wrapping chrome.storage.local; STORAGE_KEYS.SPEED constant defined here
- Updated: manifest.json — utils/storage.js added after logger.js, before sidebar.js
- Updated: content/sidebar.js — buildSidebar made async; restores saved speed from storage before attaching listeners; slider input persists STORAGE_KEYS.SPEED

### Stage 4 — 2026-06-02
- Updated: content/sidebar.js — added ext-btn-toggle (Start/Stop, data-running state), ext-slider-speed (0.5–8s step 0.5 default 2), ext-slider-value (one decimal); removed ext-status and ext-count; addEventListener only, no Amazon clicks, no setInterval
- Updated: docs/UI_ELEMENTS.md — registered Stage 4 elements; removed ext-status and ext-count

### Stage 3 — 2026-06-02
- Added: content/sidebar.js — buildSidebar() injects fixed top-center bar with title; guard against double injection; CSS via style.textContent (static only)
- Updated: manifest.json — added content/sidebar.js before content/content.js in js array
- Updated: content/content.js — removed self-test lines; calls buildSidebar() on load
- Updated: docs/UI_ELEMENTS.md — added ext-sidebar and ext-sidebar-title entries

### Stage 2 — 2026-06-02
- Updated: utils/constants.js — added ALLOWED_CLICK_INTENTS (REFRESH, NEUTRAL_ZONE), EXT_NAME, EXT_VERSION, DEBUG_LEVEL; FORBIDDEN_SELECTORS + isForbiddenElement untouched
- Updated: utils/logger.js — debug() now gated by DEBUG_LEVEL constant
- Updated: content/content.js — 4-level self-test (log/warn/error/debug) on load

### Stage 1 — 2026-06-02
- Added: manifest.json (MV3, host_permissions relay.amazon.com only)
- Added: utils/constants.js (FORBIDDEN_SELECTORS, isForbiddenElement)
- Added: utils/logger.js (logger.log, logger.warn, logger.error, logger.debug)
- Added: content/content.js (skeleton — logs "extension loaded" only)

### Stage 0 — 2026-06-02
- Added: documentation foundation (docs/ + README)
