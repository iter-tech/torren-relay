# Project State

> ## 📌 HANDOVER — READ THIS BLOCK FIRST (2026-07-31)
>
> Written at the end of the 2026-07-31 session for an incoming project manager. **This block is
> authoritative and current.** Everything below it is older narrative kept as history; where the
> two disagree, this block wins.
>
> ### Git state — read before you assume anything is safe
>
> **Most of this session IS committed**, as `9673465` *"Pre-launch fixes: PAT validation,
> logging, activation, popup, rate limiting"* — 23 files, ~2,968 insertions.
>
> **Still UNCOMMITTED in the working tree**, on top of that commit:
> - `content/networkObserver.js`, `utils/constants.js`, `content/content.js` — the entire
>   **flag-gated response-body capture** (the whole feature is uncommitted)
> - `utils/designTokens.js`, `content/inlinePanel.js` — the **inline-panel colour move**
> - `content/panelCloser.js`, `utils/constants.js`, `docs/SAFETY.md`, `docs/AMAZON_SELECTORS.md`
>   — the **filters-panel auto-collapse** (2026-08-05)
> - **`content/originCities.js` (NEW, untracked)**, `manifest.json`, `content/content.js` — the
>   **Active origin cities panel** (2026-08-05), step 1 of the multi-driver monitor
> - `docs/PRODUCT.md` (NEW, untracked) — product-level record
> - `STATE.md`, `docs/CHANGELOG.md`, `docs/BACKLOG.md`, `docs/TEST_CASES.md`,
>   `docs/UI_ELEMENTS.md` — this handover and the colour-move docs
> - `.gitignore`
>
> ### ⚠️ `samples/` IS GITIGNORED — the raw evidence does not survive a clone
>
> `.gitignore` line 8 is `samples/`. Every capture — `paired-card.html`, `paired-search.json`,
> `search-1/-2.json`, `similar-1.json`, `similar-empty.json` — exists **only on the machine that
> captured it**. A fresh clone gets none of it.
>
> The *findings* below survive because they are written here in prose. The *evidence* does not.
> Anyone wanting to re-verify the join key, re-derive a JSON path, or check a field I marked
> ABSENT will have to re-capture from a live board. **Decide deliberately whether to un-ignore
> `samples/`** — they contain real load data (addresses, payouts, carrier scores), which is
> presumably why they were excluded, so this is a genuine trade-off and not an oversight to
> silently reverse.
>
> ### Current phase
> Pre-launch hardening. The core loop (detect → highlight → sound → auto-open → auto-stop),
> Post-a-Truck, login gating and cross-tab rate limiting are all built. This session was almost
> entirely bug-fixing, verification and one day of reconnaissance. No new features shipped.
>
> ### ✅ Done AND verified by the dispatcher on a live board
> | What | Where |
> |---|---|
> | PAT modal: unparseable distance / stop count gate Confirm, with visible warnings | `content/patModal.js` |
> | Logger: `DEBUG_LEVEL` gates all four methods; **ships at 1**. Email and street addresses removed from every log payload | `utils/logger.js`, `utils/constants.js`, sweep across all files |
> | `EXT_NAME` corrected to `Torren Relay` | `utils/constants.js` |
> | Activation lockout fixed — `_extActivated` set only after every init step succeeds | `content/content.js` |
> | Popup renders from the locally stored session immediately; a network failure no longer signs the dispatcher out | `popup/popup.js`, `popup.html`, `popup.css` |
>
> ### ⚠️ Done, NOT yet verified by the dispatcher — each needs a live-board pass
> | What | Test case to run |
> |---|---|
> | Rate limiting: only 429/**502**/503/**504** trigger backoff; aborts are no longer reported at all | **TC-RATELIMIT-7** (esp. step 7a) |
> | **502 and 504 WERE added** to `RATE_LIMIT_STATUSES` — `background.js` now reads `[429, 502, 503, 504]`. A deliberate safety-side default made **without captured evidence** that Amazon throttles via a gateway status; reasoning is in the comment at the constant. **500 is deliberately excluded.** | **TC-RATELIMIT-7 step 7a** |
> | Payout selector widened for the Similar-matches variant class `wo-total_payout__match-deviation-attr` | **TC-PARSE-2** |
> | Auto-refresh stop moved into the click handler (the `waitForSheet` guard-3 regression) | **TC-PANEL-2B** |
>
> ### 🔌 Done, SHIPPED OFF — response-body capture
> `CAPTURE_RESPONSES` **exists in TWO places and BOTH must be flipped together**:
> 1. `utils/constants.js` — gates the isolated-world log line
> 2. `content/networkObserver.js` — the **MAIN-world mirror**, which is the copy that actually
>    gates the body read
>
> They are duplicated because `networkObserver.js` runs in the page's MAIN world and cannot see
> isolated-world globals (same reason, same pattern, as `background.js` mirroring
> `RATE_LIMITER_KEY`). **BOTH MUST BE `false` BEFORE ANY BUILD.** Live-board proof is
> **TC-CAPTURE-1** and has **not** been run — nothing may depend on this capture until step 3 of
> it passes.
>
> ### 🔬 JSON reconnaissance — durable findings (cost a full day; do not re-derive)
> Evidence was in `samples/` — **which is gitignored, see above.** These written findings are
> therefore the surviving record. Full working in CHANGELOG.md 2026-07-31 recon entries.
>
> - **The join key is PROVEN.** A load card's inner `<div id="…">` equals
>   `workOpportunities[].id`. Established from `samples/paired-card.html` +
>   `samples/paired-search.json`, captured at the same moment: 13 values cross-checked with
>   **zero mismatches** (payout, price/mile, distance, deadhead, stop count, both locations
>   including postcodes, duration, STARTING_SOON).
> - **Clicking a card fires zero requests to relay.amazon** — all detail already arrives with the
>   list response. *(Observed by the dispatcher in DevTools; not independently measured here.)*
> - **Both `/search` and `/similar` paginate, page size 50.** `paired-search.json`: 50 of 338 with
>   `nextItemToken: 50`. So one response is **one page, not the board** — a JSON-sourced store
>   would diverge from what is rendered.
> - **Price per mile is derived, not a field**: `payout.value / totalDistance.value`.
> - **Field availability:** `STARTING_SOON` present exactly (`workOpportunities[].tags[]`);
>   trailer "P" has a *candidate* only (`…loads[].stops[].trailerDetails[].assetOwner`, per-stop,
>   mapping unproven); the **price-increase highlight is ABSENT** from the JSON entirely.
> - **Also absent:** per-segment duration. Stop times are UTC (`actions[].plannedTime`) and need
>   per-stop timezone formatting the DOM supplies pre-formatted. The board's single
>   loading-type label is **derived** from per-stop `loadingType`+`unloadingType`, not 1:1.
> - **Cost:** ~7.7 kB/load raw JSON vs ~241 B/load for today's flat Phase-1 strings — **~32×**.
>
> **THE DECISION — narrow hybrid.** The DOM stays the source of truth for *what is on screen*.
> JSON is looked up **by id, for the clicked load only**, to populate panel content. This keeps
> pagination irrelevant (the DOM defines the rendered set) and memory bounded (one load at a
> time). **Full JSON rendering is a NO-GO.**
>
> ### 🚫 Open and blocked — ONE remaining (was three)
> 1. **Post-a-Truck cannot post R-type (own-trailer) loads** — blocked on a captured own-trailer
>    upsert payload. `providedTrailerType` is hardcoded `AMAZON_PROVIDED` at
>    `content/patApi.js:400-401`. ~24 equipment types exist across P and R variants; we support 4,
>    all provided. Full record in BACKLOG.md — **do not guess the R-type enums**, a wrong guess
>    posts a wrong truck to a live marketplace.
>
> *(The other two — inline-panel colour and filters-panel auto-collapse — are both RESOLVED. See
> below and CHANGELOG.md 2026-08-05.)*
>
> ### 🆕 Filters-panel auto-collapse — IMPLEMENTED 2026-08-05, REWRITTEN same day, needs a browser pass
> Blocked across four requests on "how do I read the panel's open/closed state?" Answered by a
> live capture: Amazon **removes `div.filters__column` from the DOM** when collapsed, so
> **presence is the state**. (The Filter *button* carries nothing — its attributes are
> byte-identical in both states, no `aria-expanded` — which is what stalled every earlier
> attempt, including three in June 2026.)
>
> `collapseFilterPanel()` (`content/panelCloser.js`, called from the existing
> `closePanelsForStart()`, START only): `querySelector('div.filters__column')` → absent means
> already collapsed, **return without clicking**; present means click once. No verification pass,
> no second click, synchronous.
>
> **A first implementation was written and deleted the same day.** It clicked, then measured a
> load card's `.left` before/after with a 20px dead band, and clicked a **second time to revert**
> when it guessed wrong — making the panel flash open and shut whenever it was already collapsed.
> Rejected and fully removed (`FILTER_ANCHOR_SELECTORS`, `findFilterAnchor`, `DEAD_BAND`, the
> rAF/350ms wait, the async/await and the call-site `.catch` all went with it; file 210 → 161
> lines). **Do not reintroduce pixel measurement on this path** — it is unreliable across
> monitors and zoom levels and is not needed.
>
> ⚠️ **Unverified in a browser: that `div.filters__column` is really the panel's container.**
> All 38 automated checks used a stubbed DOM and prove only the decision logic. **TC-FILTERS-1
> step 5** checks the selector assumption directly (expect 1 when open, 0 when collapsed) and
> should be done first; **step 2** confirms the flash is gone.
>
> ### 🎨 Inline-panel colour — RESOLVED 2026-07-31 (later), needs a visual pass
> `#F5F5F5` moved from the wrong surface to the right one, confirmed by the dispatcher:
> `--ext-leg-header-bg` (`utils/designTokens.js:48`, sole consumer `.ext-seg-header`)
> `#CFDBFB → #F5F5F5`, and `.ext-seg-body` (`content/inlinePanel.js:209`) restored
> `#F5F5F5 → #FFFFFF`. `nightMode.js` untouched; it already overrides both selectors with
> `!important`, so dark mode is unaffected.
>
> **The move fixed both contrast regressions the earlier placement had introduced:** header
> secondary text `#4A6570` 4.48 → **5.69**, stop address `#6B7280` 4.43 → **4.83** (bar 4.5:1).
> Zebra striping is back to its original 1.073:1 — subtle by design, not "fixed".
>
> **One new thing to eyeball:** the header/body seam is now **1.090:1** (`#F5F5F5` on `#FFFFFF`).
> The blue header used to read as an obvious band; now only its `border-bottom` separates them.
> **TC-PANEL-COLOUR-2 step 3.** If it reads as one flat block, that is a design call to make —
> it was outside this change's scope.
>
> ### 🧭 Future work — defined, NOT scheduled, nothing built
> **Single-Tab Multi-Driver Monitor.** One tab monitors several drivers in different regions via
> Amazon's five-city multi-origin search, splitting the merged list into per-driver sub-tabs.
> Removes the cause of the multi-tab rate limiting rather than managing it. **Post-launch or
> alongside launch, at Ihor's call — it is not part of the current phase and does not block the
> Chrome Web Store submission.**
>
> Data is verified: Amazon does **not** attribute a load to the origin that matched it, so the
> split is by **distance** from `workOpportunities[].loads[0].stops[0].location.latitude/longitude`
> (populated 50 of 50 in the on-disk capture) to the configured city coordinates, which the
> Post-a-Truck cities endpoint already supplies. Never match on city/state strings — formatting is
> inconsistent within a single response.
>
> ⚠️ **Two things to settle before building:** the 2026-08-05 five-city capture is **not in
> `samples/`**, so the "one refresh fires multiple `/search` calls" finding is recorded but
> unverified here — and it is the one most likely to cause a wrong-data bug. And Amazon applies
> **one radius to all five origins**, whose usability effect for widely separated drivers is
> **untested**.
>
> Full record: **BACKLOG.md → Single-Tab Multi-Driver Monitor** (five numbered findings with
> per-finding provenance), **docs/PRODUCT.md** (why it differentiates), **api-samples.md §6**
> (captured evidence).
>
> ### Next, in priority order
> 0. **TC-ORIGIN-2 steps 0a + 0b** — newest change: the city button's click is now a **no-op**
>    (reserved for per-city filtering, a later task) and the buttons are **bigger**
>    (`font-size:14px`, `padding:8px 14px`, ~35.5px tall). Confirm a click does nothing, that the
>    buttons are easy to hit near their edges, and that each shows the **plain city string** even
>    if a driver name is stored. **Renaming is disconnected, not deleted** — steps 1–9 of that
>    test are marked pending re-wiring and should not be run.
>    **Then TC-ORIGIN-1 step 6:** the taller buttons grew the panel 33px → 49.5px (91px wrapped),
>    so it reaches further toward the chip band in BESIDE and covers more of it in BELOW. Judge
>    whether that is acceptable — it was reported, not silently adjusted.
> 0a. **TC-ORIGIN-1 step 6e** — the panel used to flash to the top-left corner on
>    **every** board refresh (the anchor row vanishes while Amazon re-renders the list). It now
>    holds its last measured position through the gap. **Start the loop, let it refresh several
>    times, and watch the panel — any flash to the corner is a regression.** Steps 6f (first paint
>    still uses the corner fallback) and 6g (logout→login does not restore a stale coordinate)
>    cover the two edges of the same change.
> 0a. **TC-ORIGIN-2** — driver-name renaming. **Step 7 is the one that matters**: with the
>    rename input open, type `r` / `f` / `/` / space / arrows and confirm **nothing happens on
>    Amazon's board** — that is the key-event containment. Then step 3 (name present on first
>    paint, no raw-city flash) and step 8 (input survives a mid-edit board refresh).
>    **Known behaviour, not a bug:** names are per-profile, so a second tab showing the same city
>    shows the same name — but a tab already open won't repaint until its list changes or it
>    reloads.
> 0a. **TC-ORIGIN-1** — origin-cities panel placement. Repositioned **twice** on
>    2026-08-05; current placement anchors to Amazon's **"Showing N results"** line and follows it
>    via a `requestAnimationFrame` loop.
>    - **Step 1 first**: confirm in the console that the `"Origin city: "` spans exist, and that
>      a leaf matching `/^Showing\b.*\bresults?$/` exists. Both assumptions are unverified in a
>      browser; everything rests on them.
>    - **Step 6a** is the reason for the rewrite: collapse/expand Amazon's left filter panel and
>      watch the panel **travel** with the reflow rather than snapping into place afterwards.
>    - **Step 6d**: after logout, confirm no ~60fps callback is left running. That is the specific
>      risk a rAF loop introduces.
>    - **Step 6**: the panel is now expected to clear the load cards, but **can overlap the chip
>      band** in the narrow branch, and its relationship to Amazon's **sort control is
>      unverified**. Both are judgement calls for the dispatcher.
>    - **Step 8** (panel fully removed on logout) remains the regression risk.
> 0a. **TC-FILTERS-1** — newest feature, and the only one that clicks Amazon's DOM. **Step 2** is
>    the safety case: start with the panel already collapsed and confirm it ends collapsed, not
>    open. The layout measurement it rests on has never run in a browser.
> 0b. **TC-PANEL-COLOUR-2** — step 3 (header/body seam at 1.090:1) is a judgement by eye.
> 1. Run the other outstanding test cases above (TC-RATELIMIT-7, TC-PARSE-2, TC-PANEL-2B) — they
>    cover changes already in the working tree.
> 2. TC-CAPTURE-1 on a live board, then turn both `CAPTURE_RESPONSES` flags back off.
> 3. Unblock the three blocked items (one DevTools capture each — see BACKLOG.md).
> 4. Pre-launch blockers that predate this session: cross-tab rate limiting unverified in a real
>    multi-tab session (TC-RATELIMIT-1); the full six-point smoke checklist has **never** been
>    run in a browser by an agent — every change this session was verified by Node harness only.
> 5. Commit. The tree has a full session of uncommitted work.

Last updated: **2026-07-31** (was 2026-07-30)

**Full-codebase audit: 2026-07-30.** Scope: `content/`, `utils/`, `popup/`, `background.js`,
`manifest.json`, `docs/`. Read-only except for a narrow authorised auto-fix class (dead CSS,
unused declarations, literals→constants, duplicate CSS) — see CHANGELOG.md 2026-07-30 "Part B
auto-fixes only" for exactly what changed. **The audit's substantive findings were reported,
not fixed, and remain open.** Highest-ranked open items, by likelihood a real dispatcher hits
them: PAT modal posts `distMiles`/`stopCount` as `0` on parse failure with no warning and no
Confirm gating (posts a wrong load to a live marketplace); `waitForSheet()` has no cancel, so
clicking a second card quickly renders one card's panel from another card's sheet;
~~`_extActivated` is set before the awaits in `activateExtensionUI()`, so a failed activation
permanently blocks retry~~ **(B1 — FIXED 2026-07-30, see below)**; manually-typed payout/per-mile are submitted unrounded; "Reset to
Defaults" does not resync the live refresh interval in open tabs. Pre-launch blockers:
`DEBUG_LEVEL = 2` and — more importantly — `logger.log/warn/error` ignore `DEBUG_LEVEL`
entirely (only `logger.debug` respects it), so 178 `logger.log` sites stay live at any level;
console logs include the dispatcher's email and full street addresses; `EXT_NAME` is still
`'Amazon Relay Helper'` while the manifest ships as `Torren Relay`. Night Mode parity gap:
the PAT modal and sidebar each carry their own graphite dark palette that never migrated to
the navy-slate `DK_*` ramp. Doc drift: `GLOBAL_MIN_PERMIT_INTERVAL_MS` no longer exists but
is still stated as current fact in STATE.md, UI_ELEMENTS.md, and TEST_CASES.md.

**Note on this rewrite:** this file was previously maintained in Ukrainian, last content-updated
2026-07-07 (Stage 14 PAT rework), and had fallen well behind actual repo state — commits
`cb9dbf7`, `512381d`, `a5d1b21`, `23d9706`, plus this whole session's work, were never
reflected in it. Earlier in this session a duplicate `docs/STATE.md` was mistakenly created
(a directory search missed this root-level file) and updated instead of this one for several
turns; that duplicate has been deleted and its content merged in here. Written in English
from this point on, matching every other file in `docs/`.

## Поточна фаза / Current phase

> **New PM? Read `docs/HANDOFF.md` first** (created 2026-08-12) — a two-page snapshot of rules,
> current position and what is blocked. This file is the detailed status board behind it.

Post-MVP hardening + feature expansion. Core detect/highlight/sound/auto-open loop, LoadUnit
data model, Night Mode, popup wiring (Step 3), PAT ("Post a Truck" / Create Post) Helper, Card
Action Bar, multi-domain support, and Supabase email-OTP login (now gating every feature) are
all built. Working through backlog items and regional/equipment coverage expansion.

**Active thread: per-city load splitting** — the prerequisite for the Single-Tab Multi-Driver
Monitor (`docs/PRODUCT.md`). Still **log-only**: `cityAssign.js` hides, filters, reorders and
restyles nothing, and mutates no DOM. As of **2026-08-13** the id join is Ihor-verified (20/20),
the live DOM is captured, the reader is fixed to the real structure (the summary panel is a
**sibling** of the results, not a container — it was reading zero cards), and the accumulator
built around a false pagination premise is gone. **Everything now waits on one live console
read** — see In progress.

**✅ Debug flags are back at shipped state (2026-08-13):** `DEBUG_LEVEL = 1`, and both
`CAPTURE_RESPONSES` and `CITY_ASSIGN_DEBUG` `false` in both worlds. No body is read, no ids cross
`postMessage`, no raw-body transport. All diagnostic code is retained, dormant behind the flags.

**ROOT CAUSE FOUND (2026-08-12).** The 0/N id mismatch that drove the last several rounds of
investigation was **the DOM reader collecting "Similar matches" cards alongside the main
results** — two `div.load-list` elements, and the reader took the first one. A "9 of 9 results"
board yielded 13 cards; the 4 extras can never appear in `/search`, so they could never join.
Not pagination, not the join key, not the endpoint — all three of those were investigated and
cleared first. Reader is now scoped to the `search-results-summary` panel.

**Pagination/accumulation was built on a false premise.** The belief that the main list paginates
at 5 and needs scrolling came from misreading similar-matches behaviour. **The main list renders
all N at once.** The accumulator is retained (harmless, and still correct for genuine multi-page
cases) but is no longer load-bearing.

**Accumulator REMOVED — cycles are self-contained (2026-08-12).** The 0/N cause is fully
resolved and the machinery built to work around it is gone. Each cycle now matches the current
main-list cards against the current `/search` response and keeps no state. The accumulator had
been built to survive pagination that does not exist, and both of its reset rules destroyed good
data on a live board. `cityAssign.js` is **1103 → 996 lines**. Still log-only: no card is hidden,
filtered, reordered or restyled.

**Join confirmed live (2026-08-08).** The id join between load cards and captured `/search`
records is **verified working on a real board** — 20/20 captured ids matched, up from a 0/50 run
that had been assumed to mean the join pointed at the wrong field. It did not, and **no code was
changed**: the pair was already `div[id]`'s `.id` ↔ `workOpportunities[].id` (recorded
permanently in api-samples.md §6.6). The per-city assignment now produces real matches. The
remaining gap is **capture coverage, not correctness** — see "In progress".

**Active thread (2026-08-06): per-city load splitting.** The single-tab multi-driver monitor
(docs/PRODUCT.md) needs each load attributed to the origin city it came from, because the board
merges all cities into one list. Step 1 — the origin-cities panel — is built. Step 2 — the
**assignment itself** — is now built as a **read-only, flag-gated debug step** that only logs.
It is deliberately *not* wired to any UI: the assignment must be proven correct against a live
board before anything hides or filters a load on the strength of it.

## Що завершено / Done

**Reader fixed to the captured DOM (2026-08-13) — 56 automated checks, UNVERIFIED LIVE.** The
2026-08-12 scoping fix was **wrong in direction**: it walked UP for an ancestor carrying
`search-results-summary`, but that token sits on a **SIBLING** of the results, so it read ZERO
cards every cycle. Now anchors on `#search-results-summary-panel` (class fallback) and walks
**following siblings** to the first `div.load-list`. Card ids are collected by **UUID shape**
rather than card class — measured live, class-based found 8 of 9 because the recently-added card
carries a different class; the UUID filter also excludes `div[id="STARTING_SOON"]`. A collected
count that disagrees with the board's N now **skips the cycle** instead of assigning from a set
known to be wrong. Structure recorded in `AMAZON_SELECTORS.md`. Also fixed a live
**ReferenceError** (`MAIN_PANEL_TOKEN`) left in the diagnostic path.

**Main-list scoping fix (2026-08-12) — superseded by the above.**
`readRenderedCardIds()` now reads only the `div.load-list` inside the panel whose class/id
contains `search-results-summary`; if that panel is absent it reads nothing and warns rather than
falling back to the document. New `CITY DIAG 0/5` line cross-checks the collected count against
the "Showing 1 - N of N results" number — the tell that similar-matches cards are excluded.
Reproduced the exact live failure in the harness (9 main + 4 similar → 13 before, 9 after,
intersection 0 → 9/9) including the case where the similar list comes FIRST in document order.
`searchAuditId` reset removed (disproven: per-request); `originCities` is the only reset signal,
which also eliminates the two-tab thrash. Recorded in AMAZON_SELECTORS.md.

**Accumulator and both reset rules deleted (2026-08-12).** Store, 3000-entry cap,
`mergeIntoAccumulator()`, `resetAccumulator()`, all reset state, `CITY DIAG RESET`,
`CITY DIAG 5/5` and the cross-cycle coverage bookkeeping — all removed. Assignment reads the
response `pickBuffer()` selects for **this cycle only**. Verified by grep that nothing outside
`cityAssign.js` referenced any of it, and that `cityAssign.js` calls out only to
`resolvePATCity` and `getActiveOriginCities`, so the refresh loop, detection/highlight,
START/STOP, `panelCloser`, the origin panel and PAT could not be affected. `searchAuditId` KEPT
in `networkObserver.js` — still read by the `CITY ENDPOINT SHAPE` diagnostic, so not orphaned.
Post-deletion scans: **no new orphans, no write-only state** (395 declarations).

**Id join verified on a live board (2026-08-08).** `CITY DIAG 3/4` reported 20/20 captured ids
matching rendered cards. **No code change** — the join was already correct; the earlier 0/50 was
a session condition, never a wrong field. The corresponding pair is now recorded as fact in
api-samples.md §6.6, together with the fragility of `div[id]` (it selects the FIRST descendant
with any id, and the card also contains `<div id="STARTING_SOON">`) so the same false lead is not
followed twice. Diagnostics `CITY DIAG 1/4`–`4/4` and `CITY RAW 1`–`4` remain in place, behind
the flag, to confirm the intersection stays non-zero.

**Per-city assignment foundation (2026-08-06) — read-only, SHIPPED OFF, UNVERIFIED LIVE.**
New `content/cityAssign.js`: on each completed refresh it assigns every on-screen load card to
the nearest active origin city by haversine distance from the PICKUP stop's lat/lng, and logs one
compact count line plus a reasoned unmatched list. **Changes nothing the dispatcher sees** — no
hiding, no filtering, no reordering, no restyling, no UI, no DOM mutation of any kind.
Supporting changes: `emitCityAssignCoords()` in `networkObserver.js` (MAIN world) extracts
`{id, lat, lng}` triples so the ~300 KB body never crosses `postMessage`, with
`summariseAndDiscard()`'s no-identifiers contract left byte-identical; `getActiveOriginCities()`
added to `originCities.js` as a read-only accessor returning a copy of the last *rendered* list;
`initCityAssign()`/`teardownCityAssign()` wired into the existing activate/deactivate steps.
Verified with 92 automated checks against the real source files (assignment counts, unmatched
reasons, multi-response selection, distance threshold, haversine cross-checked against an
independent formula, teardown, flag-off inertness, zero DOM mutation, zero layout reads).
**Never run in a browser** — see Blockers.

**Core system (Stages 0–13, complete):** MV3 manifest; `utils/constants.js`
(`FORBIDDEN_SELECTORS`, `isForbiddenElement`, `ALLOWED_CLICK_INTENTS`); `utils/logger.js`;
`utils/storage.js` (`STORAGE_KEYS` + async get/set/remove/getAll); `utils/tabState.js`
(per-tab pub/sub store: running, surgeThreshold, priceHistory — `refreshIntervalMs` moved
to a global setting 2026-07-20, see "Cross-tab rate limiting" below);
`content/refreshManager.js`, `loadParser.js`, `loadDetector.js`, `highlighter.js`,
`detailOpener.js`, `inlinePanel.js`, `sidebar.js`, `loadObserver.js` (MutationObserver instant
detection), `panelCloser.js`, `content.js` (orchestrator). `background.js` (service worker)
added 2026-07-20 — see below.

**Step 3 — popup controls wired:** Night Mode, Tab Alert, Hide Similar Matches, Auto-Open Top
Load (true-default), Sound block (25 sounds, volume, preview), Hide tag filters (Promoted /
Starting soon / Trailer ready / Booked before), Price Surge Alert (per-tab threshold via
tabState), Reset to Defaults.

**LoadUnit data model ✅** (`utils/loadStore.js`) — in-memory per-tab store, Phase 1 (board
fields) wired in `loadParser.js`, Phase 2 (detail struct) wired in `inlinePanel.js`.

**Card Action Bar ✅** — Copy Screenshot (`html2canvas`, vendored), Route Map (Google Maps
Directions URL), Create Post (opens PAT modal).

**PAT Helper (Stage 14) ✅** — `content/patApi.js` + `content/patModal.js`. Equipment support:
53' Trailer, 53' Container and Chassis, 40' Container, 26' Truck (commit `23d9706`). City
resolution via live API with dotted-abbreviation + prefix/subsequence fallbacks, draggable
modal, payout rounding (commits `a5d1b21`, `512381d`). **Default Payout markup changed
2026-07-20:** flat `PAT_TEST_MARKUP_USD = 5000` → `PAT_PAYOUT_MARKUP_RATE = 1.10` (board
payout × 1.10, rounded to 2 decimals), dispatcher can still edit freely. Edge case: if board
payout is missing/unparseable, Payout is left **empty** (no silent fallback), a visible
warning (`ext-pat-payout-warning`) shows "Board payout could not be read — enter payout
manually", and Confirm stays disabled until a valid amount is entered — see
`updateConfirmEnabled()` in `patModal.js`. `docs/SAFETY.md` updated to reflect that the old
markup's "obviously fake price" safety property no longer applies (10% is a plausible real
offer); the dispatcher-must-click-Confirm gate is now the primary control for this feature.

**Multi-domain support ✅ (2026-07-17)** — `manifest.json` `host_permissions` /
`content_scripts.matches` cover all 11 Amazon Relay regional domains (ca, co.jp, co.uk, com,
cz, de, es, fr, it, in, pl). No hardcoded-domain code changes needed elsewhere —
`content/patApi.js` already used relative fetch paths. Non-US locale handling (city/address
format differences) explicitly deferred until real captured data exists.

**Supabase email-OTP login ✅ live (2026-07-17, hardened 2026-07-20):**
- Three-step "Account" section in the popup (email → code → logged-in). `vendor/supabase.min.js`
  (supabase-js v2.110.7 UMD, vendored — MV3 forbids remote scripts) + `utils/supabaseConfig.js`
  (`SUPABASE_URL`/`SUPABASE_ANON_KEY`, real project credentials from the PM, **gitignored** —
  `utils/supabaseConfig.example.js` is the committed placeholder template).
- **Pending-state bug fixed (2026-07-20):** "Send code" now persists
  `{ pendingEmail, step: 'code' }` to `chrome.storage.local` (`AUTH_PENDING_KEY`) — previously
  in-memory only, so closing the popup before entering the code silently reset the flow.
  Popup reopen now resumes the code step if a pending email is stored.
- **OTP code length fixed (2026-07-20):** Supabase sends 8-digit codes; the input used to hard
  cap at 6 and reject them. Now accepts 6–10 digits (`maxlength="10"`, validated via
  `/^\d{6,10}$/` — digits only, not a fixed length). Label added: "Code from email".
- **Full feature gating (2026-07-20):** every extension feature now requires an active
  session, via new shared module `utils/authGate.js` (`getAuthGate()` cached /
  `recheckAuthGate()` fresh). Checked at content-script startup (`content.js` — closed gate
  ⇒ no sidebar, no inline panel, zero extension DOM on the page) and again when the sidebar's
  play/pause is turned on (`recheckAuthGate()`, since a tab can sit open for hours).
  `nightMode.js`, `filterSimilar.js`, `filterTags.js` each self-initialize independently of
  `content.js`, so each got its own gate check + a guard flag on its live
  `chrome.storage.onChanged` listener. An expired-but-refreshable session refreshes silently
  (never logs out); content scripts never clear a bad session themselves (that stays
  `popup.js`'s job, avoiding multi-tab races). **Popup gating UI (2026-07-20):** when logged
  out, the popup shows only the login block — headline "Free access — sign in with your email
  to activate Torren Relay" (`popup-auth-gate-note`) plus the email/code form; every feature
  control (Display & Alerts, Sound, Price Surge, Load Board Filters, Booking, Reset) lives in
  a single `popup-features` container gated by the same `showAuthStep()` that drives the auth
  steps. Logged-in state shows email + Log out at top, features below.
- **Live activation/deactivation, no reload required (2026-07-20 — TASK 1, resolves the
  "known limitation" above):** `utils/authGate.js` gained `onAuthGateChange(callback)` +
  a `chrome.storage.onChanged` listener on `SUPABASE_SESSION_KEY` — any login/logout via the
  popup is detected on every already-open Relay tab within about a second, via a real
  active↔inactive transition check (`_handleGateResult`), not on every session write (a
  silent refresh must not re-fire "activate"). `content/content.js` split its startup logic
  into idempotent `activateExtensionUI()` / `deactivateExtensionUI()`, both wired to
  `onAuthGateChange` — login instantiates sidebar + inline panel + loop exactly as if the
  page had loaded already logged in; logout stops the loop, removes the sidebar/inline
  panel/highlights, and reverts the page to fully untouched, all without a reload.
  `content/nightMode.js`, `filterSimilar.js`, `filterTags.js` each gained their own
  `activate*()`/`deactivate*()` pair for the same reason (they self-initialize independently
  of `content.js`). `content/inlinePanel.js`'s one-time-registered manual-toggle click
  listener now checks `isAuthGateActiveSync()` on every click (it can no longer assume
  "if I exist, we're logged in"). Fixed two real leaks this surfaced: `utils/tabState.js`
  gained `unsubscribe()` (repeated login/logout cycles were adding a permanent subscriber
  each time), and `content/sidebar.js`'s memory-poll `setInterval` is now stashed on the
  sidebar container and cleared on deactivation (was previously unclearable, would have
  polled forever against detached DOM after every logout). **Not yet exercised in a
  browser** — see docs/TEST_CASES.md TC-AUTH-6 for the exact manual steps required.

**Rebrand to "Torren Relay" — partial, scoped (2026-07-17):** `manifest.json` (`name`,
`default_title`) and popup (`<title>`, `.popup-title`) updated. `description` intentionally
left as-is (full copy rewrite comes before Web Store submission). `utils/constants.js`'s
`EXT_NAME` — which feeds the on-page sidebar title — was **not** changed (out of requested
scope); the injected sidebar still reads "Amazon Relay Helper" until that's folded into a
later rebrand pass.

**Read-only logic audit + 3 fixes (2026-07-20):** a full read-only audit across content/,
utils/, popup/, manifest.json found and ranked logic bugs by severity. Three fixed, one at
a time, each verified with a real Node `vm`/functional test (not just structural checks)
before being reported done: (1) `resolvePATCity()` referenced an undeclared `boardStopStr`
in its empty-city error log, throwing uncaught and — via `Promise.all` — discarding a
sibling city that resolved fine; fixed to use the real parameter, moved inside the
function's `try` block. (2) `patModal.js` silently fabricated a load's start/end time
(`fallbackTime(1)`/`fallbackTime(4)` = "now +Nh") whenever the real time was missing/
unparseable, with Confirm left enabled — posted a fictional availability window; fixed with
the same no-silent-fallback pattern already used for missing Payout (empty field, visible
warning, Confirm blocked live until manually entered). (3) `content.js`'s
`runDetectionPipeline`/`orchestratorTick` never re-checked the login gate or
`tabState.get('running')` across their multiple `await` points, so a logout landing
mid-tick let it finish anyway — highlighting cards, playing sound, and recreating
`#ext-inline-panel` after `deactivateExtensionUI()` had already torn everything down; fixed
with a shared `shouldContinue()` checkpoint after every await plus `clearPipelineDom()` to
make deactivation authoritative regardless of exactly where a tick got interrupted.

**Inline panel CSS — width fix + polish (2026-07-20, three passes):** pass 1 (a hypothesis,
`.ext-inline-panel{width:100%}`) turned out insufficient — reported back by the user with a
live-measured correction. Pass 2 fixed the REAL root cause, found by the user's own live
browser measurement (not a hypothesis this time): Amazon has a global `table{display:block}`
rule on the page, and a block-level table ignores `width:100%` for its own internal layout
(builds an anonymous shrink-to-fit table box instead) — fixed with
`display:table !important;width:100% !important` on `.ext-inline-panel__table`, with a
comment warning not to remove the `!important`. Pass 3 was a design polish pass (segment
header route grouping — required a small DOM restructuring in `buildPanelElement()` since
CSS alone can't merge two sibling grid items into one flex cell; table header/cell
typography; zebra striping, including a Night Mode counterpart in `content/nightMode.js` a
blanket dark-mode override would otherwise have silently erased). All three passes verified
via Node `vm` structural + DOM-shape checks (not live rendering — no browser available);
none of the three has been visually confirmed in an actual browser yet.

**Cross-tab rate limiting (2026-07-20) — PRE-LAUNCH BLOCKER, see docs/BACKLOG.md:**
confirmed with real data — 3-4 Relay tabs, each with its own independent 2s refresh timer,
produced sustained HTTP 503 from Amazon across all tabs (IP-based throttle, confirmed by
switching networks). New `background.js` (this extension's first-ever service worker) acts
as a permit dispenser + backoff state machine, coordinating ONE global request budget
across every open tab via `chrome.storage.local` (not in-memory state — MV3 service
workers are not persistent). New `content/networkObserver.js` (MAIN-world, a new kind of
injection this codebase hasn't used before) observes real HTTP status on
`/api/loadboard/search` read-only, for 503/backoff detection. The refresh-interval slider
moved from per-tab (`utils/tabState.js`) to a global `chrome.storage.local` setting.
Backoff: 5/10/20/40/80s capped at 5min, ±20% jitter, reset only on a real 200. Every tab's
sidebar shows a synchronized amber paused banner while blocked. **Countdown removed
2026-07-30** — it displayed our own backoff timer, which is not Amazon's unblock time, reset
on page reload, and meant nothing on reaching zero; the banner is now static copy plus an "i"
explainer tooltip, and it is gated on a new sticky `rateLimited` display flag (set on any
reported failure, cleared only on a reported 2xx) rather than on `backoffUntil`, so it
survives both timer expiry and a page reload and disappears on the first real success. The
backoff/permit machinery itself is unchanged (A/B verified). `GLOBAL_MIN_PERMIT_INTERVAL_MS = 5000` is explicitly marked empirical/unverified
in its own comment, per instruction — not a confirmed safe rate. **Verified with real
functional tests** (not structural checks — `background.js` has zero DOM dependency): 18/18
on the core permit/backoff algorithm (pacing, FIFO fairness, jitter, backoff schedule,
reset-on-success, and persistence across a simulated service-worker restart) + 4/4 on the
content-script integration. **Not verified in an actual multi-tab browser session** — see
Blockers below and docs/TEST_CASES.md TC-RATELIMIT-1.

**Cross-tab rate limiting made OPTIONAL (2026-07-30 follow-up):** the shared budget from
the item above is no longer forced. New "Shared refresh limit" toggle in the popup
(`popup-shared-limit`, `chrome.storage.local` key `sharedRefreshLimitEnabled`,
true-default, global, live-synced across tabs via `chrome.storage.onChanged` — same
mechanism as the login-state live activate/deactivate). ON = unchanged prior behavior
(shared pacing floor + backoff). OFF = each tab fires on its own schedule with no pacing
coordination — but **503 backoff is never optional**: `background.js`'s
`grantOrDenyPermit()` now checks backoff first, unconditionally, and only gates the
pacing-wait step behind the new flag, so a paused tab still shows the countdown banner in
either mode. A circled "i" icon next to the label shows the exact requested explanatory
tooltip on hover and keyboard focus (adapted from `content/sidebar.js`'s existing
memory-info tooltip pattern — no popup-side precedent existed before this). `content/
sidebar.js` needed zero changes — its rate-limit banner already reads the shared backoff
state directly, independent of any mode. **Verified with real functional tests**
(`background.js`, zero DOM dependency): 15/15 — OFF-mode grants with no pacing wait,
ON-mode (and flag-omitted, for backward safety) still paces at ~5s, backoff denies in both
modes, OFF-mode resumes instantly once backoff clears, success fully resets backoff.
Popup/content.js wiring verified structurally only (source-text assertions — DOM-heavy
files, no browser available). **Not verified in an actual browser** — see
docs/TEST_CASES.md TC-RATELIMIT-2 for the exact manual steps required (tooltip
hover/keyboard behavior, live cross-tab sync, OFF-mode independent timers, OFF-mode
backoff still pausing/showing the banner, Reset default, persistence across restart).

## Що в роботі / In progress

**✅ PER-CYCLE cityAssign VERIFIED LIVE (2026-08-13).** Across several auto-refresh cycles:
`CITY DIAG 0/5` MATCH: YES every cycle, `CITY DIAG 3/4` intersection **full (30/30, 28/28)**,
**zero unmatched**, zero RESET lines, **and the board rendered normally** with the
`Response.prototype` wrapper in place. The per-city assignment is now known-correct on real data
— the first time that has been true. PLAN.md tasks 1, 2 and 3 are done.

**Capture rewritten to piggyback Amazon's own read (2026-08-13) — now verified by the above.** The trace
found the fault and a console experiment confirmed the fix direction: the SPA aborts its own
in-flight search, which errors both branches of our clone's tee, so the response that renders the
board died with `AbortError` every cycle while Amazon's own `Response.json()` read of the *same*
response succeeded. `resp.clone()`/`snapshot.text()` are retired; `Response.prototype.json`/`.text`
are wrapped instead, returning the original promise object unchanged. **This is the first build
that can see the active board's data at all.** Risk to watch: `Response.prototype` is global, so
the wrapper is in the path of every fetch on the page — Ihor must confirm the **board itself still
renders normally**, not just that our logs appear. `rawBody` is null on this path; see CHANGELOG
for which diagnostics lose data.

**Earlier: capture path instrumented; the trace is what found the fault (2026-08-13).** Live evidence:
every refresh observes `/api/loadboard/search` **twice** but captures it **once**, and the one
captured belongs to a *different* saved-search tab (woCount 2, bodyLength 27377) while the active
board showed "of 1 results". The buffer is healthy — `buffers: 4`, `CITY DIAG 0/5 MATCH: YES`
every cycle — so this is **not** the buffer cap. Eight previously-silent discard points now emit
a reason code with a per-request `seq`, and each successful capture emits its path +
`totalResultsSize`. **Next action is a console read, not a code change:** the reason code on the
dropped `seq` names the fault. Leading suspect from the code is `clone-threw` — `resp.clone()`
fails when the body has already been consumed, which would explain exactly one of two responses
surviving.

**Nothing is gated on a live read any more.** The per-city assignment is verified and the flags
are off. The thread's next step is a *decision*, not an investigation: `cityAssign` is still
**log-only**, and moving it to actually filtering cards (PLAN.md task 6) is the first change in
this entire line of work the dispatcher will see. It needs its own review, its own TEST_CASES
entries, and `SAFETY.md` re-read before anything hides a load.

**The harness estate is the immediate blocker on further code changes (PLAN.md task 4).** Five
suites are red or crashing; two are green and current. Until that is fixed, the next code change
lands with an unreadable test signal.

**`citydrop-harness` joined the rebuild list (2026-08-13).** Five of its eight sections drive the
retired clone path and its stubs are plain objects rather than `Response` instances, so it now
crashes early. Its still-valid coverage (XHR drop reasons, the isolated-side receiver) is real but
unreachable until it is rebuilt. Green and current: `citypiggy-harness` (53) and
`citysibling-harness` (56).

**The harness estate needs rebuilding, not patching (2026-08-13).** `citysibling-harness` is
**56/56 green** and is the only suite modelling the DOM the dispatcher actually captured. The
other four are red for a diagnosable, non-code reason: **four of five stub the summary panel as
an ANCESTOR** of the load-list (the structure just disproven), **none provide
`getElementById`**, and several use fixture ids like `'p1'`/`'m1'` that the new UUID filter
correctly rejects. Two crash outright on a null log line rather than asserting. Plus the 43
assertions still naming accumulator functionality deleted on 2026-08-12. **These are fixture
faults, not code faults** — PLAN.md task 4.

**Five harness suites need retiring or rewriting — NOT yet touched (2026-08-12).** 43 assertions
went red on deletion. **Every one names the accumulator, a reset, or a deleted log line**; the
core behaviour suites are green (the confirmed live shape — 9 main + 4 similar → 9 collected,
9/9 intersection, 0 unmatched — still passes). `cityaccum-harness` (31 red) tests deleted code
end to end and should be retired outright. The other 12 are individual assertions inside
otherwise-green suites. **Deliberately left red rather than edited**, per the "do not fix a red
suite by changing tests" rule — awaiting a decision.

**Per-city assignment — settle delay and threshold still unconfirmed (2026-08-06).** The code is written and
passes 92 automated checks, but the checks run against stub DOM and synthetic responses. What
they **cannot** prove: that the settle delay is long enough on a real board, that a real refresh
really does buffer more than one `/search` response (§6.4 in api-samples.md is still unverified),
that 150 mi is the right cutoff, and — the whole point — that the per-city counts match what the
dispatcher actually sees. **Next action is a human console read, not more code.** Procedure and
the four switches that must be flipped are in CHANGELOG 2026-08-06; all four must go back off
afterwards.

**RECON 2026-07-31 — JSON rendering: NO-GO on full replacement, conditional GO on detail
enrichment.** No code changed. Analysed `samples/search-1/-2.json`, `similar-1.json`. Three
unknowns: STARTING_SOON **found exactly** (`workOpportunities[].tags[]`), trailer "P" has a
**candidate** (`…loads[].stops[].trailerDetails[].assetOwner` = AZNG/NCSL/HUBG, per-stop, mapping
unproven), price-increase **ABSENT** (0 occurrences of `INCREASE`) — though we do not render it
today either, so it blocks nothing current. The real blockers are pagination (one response = one
page: 50 of 232, `nextItemToken` = offset; JSON holds far more than the board renders ⇒ false
new-load alerts) and memory (~7.7 KB/load vs ~241 B today, **~32×**; ~1.8 MB per similar query per
tab). Full detail in CHANGELOG.md 2026-07-31.

**BUILT 2026-07-31 — flag-gated response-body capture (capture & discard), shipped OFF.**
`utils/constants.js` + `content/networkObserver.js` + one additive listener in `content/content.js`.
Renders nothing, stores nothing. **⚠ The flag is a TWO-FILE edit** — networkObserver runs in the
MAIN world and cannot see `constants.js`, so it carries a mirrored constant (same pattern as
background.js's RATE_LIMITER_KEY); the mirror is what gates the body read. `logger` is likewise
absent in MAIN, so the summary is postMessaged over and logged isolated-side, which is what makes
it silent at `DEBUG_LEVEL = 1`. Capture scope (`CAPTURE_PATHS`: search + similar) is deliberately
separate from `WATCH_PATH` (search only) so `/similar` never feeds the rate limiter. 38 automated
checks incl. a reproduced double-read failure and a byte-identical A/B of the OFF path against
HEAD. **Live-board proof is TC-CAPTURE-1 and has NOT been run — nothing may depend on this
capture until step 3 of it passes.**

**RECON part 3, 2026-07-31 — paired capture analysed** (`samples/paired-card.html` +
`paired-search.json`). **Join key PROVEN** — card's inner `<div id>` = `workOpportunities[3].id`,
13 values cross-checked, **zero mismatches** (payout, ppm, distance, deadhead, stopCount, both
locations incl. postcodes, duration, STARTING_SOON). **/search DOES paginate** — 50 of 338,
`nextItemToken: 50` — so the "one response ≠ the board" finding now holds for the main feed, not
just `/similar`. **Trailer "P" narrowed but NOT settled:** badge present ↔ `assetOwner: "AZNG"`
(pickup stop only), but positive-only — needs a card *without* the badge. Ready-made candidates
in the same file: `31e38152-e11b-4a04-8cc7-5ae71784aff7` (NCSL) or
`5aa112da-cbbd-43f4-9b39-6d09e509a9f5` (HUBG). **New gap found:** the board's single loading-type
label (Drop/Live/Live-Drop/Drop-Live) is derived from per-stop `loadingType`+`unloadingType`, not
1:1 — rule unknown from one card. Go/no-go unchanged.

**FIXED 2026-07-31 — payout parsed as null for the entire "Similar matches" section**
(`content/loadParser.js`, one selector). Cause: `.wo-total_payout` matches whole class tokens, and
that section wraps the payout in `wo-total_payout__match-deviation-attr` — one indivisible token,
not a suffixed variant. Selector now matches both. `|| null` guard untouched, `patModal.js` not
modified. 25 automated checks against both real markup shapes; browser half is TC-PARSE-2.

**🔶 Open, needs one capture:** `.wo-total_payout__modified-load-increase-attr` (price-increase
highlight) is a documented third member of the same family and is **still unmatched** — those
loads likely have the same silent null payout. Deliberately not added without proof it is the
payout element and not a preceding badge, since `querySelector` takes document order and a badge
would yield the wrong number. Capture a price-increased card's inner HTML → one-token fix. Also
unverified in that section: the parser's non-`wo-*` selectors (`.equipment-type-text`,
`.trailer-type-circle`, `.loading-type`, `span[title="Deadhead"]`, `#STARTING_SOON`, `div[id]`).
See AMAZON_SELECTORS.md "Payout inner-class family".

**Load row background → #F5F5F5, done 2026-07-31** (`content/inlinePanel.js`, `.ext-seg-body`,
one hex). Light mode only by construction — `nightMode.js` overrides that exact selector with
`DK_HIGH !important`. 12 automated checks; visual half is TC-PANEL-COLOUR-2, not run. **Flagged:**
the zebra striping (`var(--ext-n100)` = #f5f7fa) is now nearly invisible against #F5F5F5. Also
flagged: "load rows" was read as the per-leg body, not the table cells — one-line change if the
other reading was meant.

**⛔ STILL BLOCKED (2nd request) — collapse Amazon's left filters panel on START.** The new
capture (`aria-label="Filter  "`, trailing spaces) **invalidated the selector this repo previously
recommended** — exact-match `[aria-label="Filter"]` matches nothing; BACKLOG.md now has a
trim-based lookup. Finding the button is solved. Reading whether the panel is open is not, and
that is the blocker: the control is a toggle, so acting blind would open it when already
collapsed. DevTools capture snippet unchanged, in BACKLOG.md.

**FIXED 2026-07-31 — card click stopped stopping the refresh loop** (`content/inlinePanel.js`).
Cause: `tabState.set('running', false)` sat inside `waitForSheet`'s callback, which is gated by
guard 3 (`!document.contains(card)`) from the uncommitted 2026-07-30 single-flight fix. While the
loop runs, `refreshNow()` makes Amazon re-render the list and detach the clicked card inside the
poll window, so the run was discarded and the stop never executed. The stop now runs
synchronously at the click, before `waitForSheet`; guard 3 still governs the render, which is all
it was meant to protect. Still exactly one stop call in the file — nothing was added at another
layer. 24 automated checks incl. a detached-card mechanism proof; browser half is TC-PANEL-2B,
not run. **Note:** the log line quoted in the bug report is a `logger.log` requiring
`DEBUG_LEVEL >= 3`, but the repo ships `DEBUG_LEVEL = 1` — it cannot appear in a stock build, so
that build had the level raised.

**Accordion leg-header colour → #CFDBFB, done 2026-07-31** (`utils/designTokens.js`, one token
value). Light mode only by construction — `nightMode.js` overrides `.ext-seg-header`'s background
with `!important`, so the token's value is never exercised in dark mode. 21 automated checks;
visual half is TC-PANEL-COLOUR-1, not run. **Known contrast regression, reported not fixed:** the
secondary text `#4A6570` (distance/duration, route arrow, chevron) drops 4.88:1 → **4.48:1**,
just under WCAG AA 4.5:1 for 11–12px text. One-line fix available (`#49646F`, 4.55:1) at
`inlinePanel.js:173/178/200` — awaiting a decision.

**⛔ BLOCKED 2026-07-31 — collapse Amazon's left filters panel on auto-refresh START.** Nothing
implemented; stopped deliberately rather than guess. This feature was built and removed once
before (CHANGELOG 2026-06-18 — three strategies, none reliable), which also removed
`CLOSE_FILTER_PANEL` from `ALLOWED_CLICK_INTENTS` and its SAFETY.md click-site section, so
re-adding it needs click-site re-authorisation. **Solved this round:** all three prior attempts
used `button[aria-label="Filter"]`, but the new capture shows the label is on an inner
`<span role="img">` — so those selectors matched nothing, which explains the failures.
**Still blocked:** no reliable way to read whether the panel is currently open. The control is a
toggle, so acting without that read would OPEN it when already collapsed. The exact DevTools
capture needed to unblock (a paste-in snippet, run once with the panel open and once collapsed)
is in BACKLOG.md.

**Sidebar paused/rate-limit message REMOVED 2026-07-31** (PM decision, `content/sidebar.js`
only). The amber "Paused — Amazon has temporarily limited your IP…" line, its "i" icon, and that
icon's tooltip are gone; nothing about the paused state renders any more. **The backoff/pause
behaviour is untouched** — `background.js` and `content/networkObserver.js` were not edited at
all, and the extension still stops polling on 429/503 and still auto-resumes. Verified with a
Node `vm` harness driving the real `background.js` and the real `buildSidebar()` (79 checks);
browser half is TC-RATELIMIT-6, not run. Two judgment calls flagged in CHANGELOG.md: the slider
no longer hides during a pause (that hiding existed only to make room for the banner), and
`renderSharedRateStatus()` was left as-is so row 2 still hides while paused. **Reinstatement
record — verbatim original code — is in BACKLOG.md**, not commented out in the source.

**✅ Spurious-pause bug FIXED 2026-07-31** (`content/networkObserver.js` + `background.js`). Was:
the paused state was entered by **any** failed or aborted `/api/loadboard/search` request, so an
ordinary saved-search switch (which aborts the in-flight request) silently stopped monitoring and
escalated through 5/10/20/40/80s while the dispatcher's board carried on looking fine. Now:
aborts are never reported (fetch checks `signal.aborted` + `err.name === 'AbortError'`; XHR
subscribes to `load`/`error`/`timeout` instead of `loadend`), and only `RATE_LIMIT_STATUSES =
[429, 502, 503, 504]` enter backoff — everything else returns without writing state, so an
in-flight backoff is neither extended nor cleared. **The backoff machinery itself is unchanged**,
proved by A/B against the committed `background.js` (identical step sequences and reset behaviour
for all four statuses). 104 automated checks pass; browser half is TC-RATELIMIT-7, not run. The
false comment at `background.js:208-212` was corrected as part of the same change.

**502/504 are a deliberate safety-side default made WITHOUT captured evidence** (PM decision,
same day). We have never observed Amazon throttling via a gateway status; they are included
because the cost is asymmetric — an un-backed-off throttle risks a real IP block on the
dispatcher's account, an ordinary gateway error costs a few seconds. Recorded at the constant in
`background.js` so it can be revisited if evidence appears. **500 stays out.**

**Open decisions still handed back (report only, CHANGELOG.md 2026-07-31):** what 500, 401/403
(recommend a gate re-check, not backoff), 404 (recommend a loud log — sustained 404s mean
`WATCH_PATH` went stale and we are blind), and status 0 (recommend leaving as-is) should each do.

**Audit finding B1 (High) — activation lockout — FIXED 2026-07-30, `content/content.js` only.**
The first of the audit's substantive findings to be fixed rather than just reported.
`_extActivated` is now set only after `tabState.init()` + `buildSidebar()` + `initManualToggle()`
have all succeeded; a throw logs `logger.error` with the failing step, rolls back through the
existing `deactivateExtensionUI()` teardown, and leaves the flag false so the next activation
retries. A separate `_extActivating` in-flight guard, cleared in a `finally`, keeps two
concurrent calls from initialising twice. Proved at the control-flow level with a Node harness
over the real source text (44 checks, all pass); **still unverified in a browser** — see
TC-AUTH-8. Two adjacent issues were found and deliberately left unfixed (logout arriving
mid-activation; the `ext-sidebar-styles` `<style>` tag never removed on teardown) — both written
up in CHANGELOG.md 2026-07-30.

**Popup opens straight into the panel, and a lost connection no longer signs anyone out —
FIXED 2026-07-30** (`popup.html` / `popup.css` / `popup.js`). Both symptoms had one cause: the
popup awaited a network round trip before deciding what to render. It now decides from the
locally stored session (same 30s expiry margin, same comparison) and renders immediately, then
validates in the background. When validation fails it distinguishes a server verdict from an
unreachable server using the Supabase bundle's own `isAuthRetryableFetchError` — unreachable
means the dispatcher stays signed in, the session is not cleared, and an inline "No connection"
note appears in the existing status line. No Supabase call, storage key, or branch condition
changed; only when results are applied. The interim "Checking your session…" state and its
3000ms timer, added earlier the same day, are removed. Proved with a Node `vm` harness running
the **real** Supabase bundle with only `fetch` swapped (51 checks); **visual/timing claims are
unverified** — see TC-AUTH-9 steps 1, 2, 6.

**Known slow path (library behaviour, unchanged):** on *expired session + offline*, gotrue's
`_refreshAccessToken` retries internally for up to `N = 30*1e3` (measured ~25.6s) before the
failure surfaces, so the "No connection" note on that one path is late. The login form still
appears instantly and the session is still not cleared. Valid-session + offline is prompt —
`setSession`/`_getUser` has no retry wrapper.

**PART B analysis (report only, nothing optimised), CHANGELOG.md 2026-07-30:** established that
`setSession()` is a real network `GET /auth/v1/user` (read out of the shipped bundle), measured
171–499ms cold; that the signed-in answer including the email is already in
`chrome.storage.local` before it runs; and that nothing is cached between popup opens. That
report is what the fix above is built on. `utils/authGate.js:37` still does the same network
validation in every content script on every page load — untouched, same opportunity.

**Follow-up report (also 2026-07-30, nothing implemented):** whether `supabase.min.js` can be
loaded after first paint. Yes in principle — first paint no longer needs it — but **not** by
moving or deferring the `<script>` tag, which would leave `supabaseClient` null and route every
dispatcher to the login form. It needs lazy client creation plus fixing five `if
(!supabaseClient)` guards that currently say "Login not configured.". And the payoff is
**inferred, not measured** — measure "Evaluate Script" for the bundle in the devtools
Performance panel before deciding it is worth the failure modes.

Otherwise nothing actively in-flight. All work above is implemented and syntax-checked but **not yet
committed to git** (see `git status`) and **not yet manually driven through a loaded-unpacked
Chrome session** — no browser available in these sessions. Everything from "Supabase login"
onward needs a real browser pass before being considered verified. See `docs/TEST_CASES.md`
TC-AUTH-1 through TC-AUTH-8, TC-PAT-CITY-1, TC-PAT-TIME-1, TC-PANEL-WIDTH-1/2,
TC-PANEL-POLISH-1, and TC-RATELIMIT-1 for exact steps.

Also this session: `docs/CLAUDE.md` gained a new "Verification rules" section (PROOF BEFORE
REPORT + the six-item SMOKE CHECKLIST) — this file's own repeated "not yet exercised in a
browser" caveats above are this session applying that rule to itself, not just documenting
it.

**Interpretive judgment call flagged for review (2026-07-30):** the "Shared refresh limit"
toggle's OFF mode was implemented as disabling only the PACING/COORDINATION step, leaving
the refresh-interval *value* itself global (unchanged from the prior task). The task's
wording ("each tab runs its own independent timer... exactly as before this change") could
also be read as reverting the interval setting's storage back to per-tab. See CHANGELOG.md
2026-07-30 entry for the full reasoning; flagged so the user can correct this if the
intent was broader.

## Що далі / Next

- **✅ DONE 2026-08-13 — live verification of the per-cycle assignment** (PLAN.md tasks 1-3).
  Full intersection, zero unmatched, board unaffected. Flags returned to shipped state.
- **1. Rebuild the harness suites** (PLAN.md task 4). Five red or crashing, two green. This is the
  blocker on every subsequent code change — without it the next run's signal is unreadable.
- **3. Only once `MATCH: YES` is confirmed:** design the move from log-only to **actually
  filtering cards**. First dispatcher-visible change in this whole line of work — needs its own
  review, its own TEST_CASES entries, and `SAFETY.md` re-read before anything hides a load.
- **4. Finish the pending cleanup** (`docs/HANDOFF.md` §5): correct the falsified pagination
  claims in `api-samples.md` §6.5/§6.7; optionally split the ~400 lines of flag-gated diagnostics
  out of `cityAssign.js`. Note Phase 1 found **zero orphans** — do not commission a blind sweep.
- **AUDIT `content/loadParser.js:124`** — it makes the same "first `div.load-list` is main"
  assumption and feeds highlighting/alerts, so it may be treating similar-matches cards as
  results. Not touched in this task; needs its own.
- **If coverage reaches the full board**, per-city counts are complete and the feature is ready
  to move from log-only to **actually filtering cards** — the next thread. That is the first
  change in this whole line of work that the dispatcher will *see*, so it needs its own review,
  its own TEST_CASES entries, and the safety rules re-read before anything hides a load.
- **Then:** tune `CITY_ASSIGN_MAX_MILES` (150 is a guess) and
  `CITY_ASSIGN_SETTLE_MS` (700 is a guess) against what the logs actually show.
- **Then:** decide whether the city-coordinate cache should persist across page reloads. It is
  currently in-memory per page session — correct and cheap, but a reload re-resolves each city.
- **Only after the assignment is confirmed:** wire the city buttons in `originCities.js` to
  per-city filtering (their click is already deliberately a no-op, reserved for exactly this),
  and add the TEST_CASES entry that was deliberately withheld while there is no user-visible
  behaviour to test.
- **PRE-LAUNCH BLOCKER — cross-tab rate limiting must be verified in a real multi-tab
  browser session before this extension is distributed to more than one dispatcher** — see
  docs/BACKLOG.md's "🚫 PRE-LAUNCH BLOCKER" section and docs/TEST_CASES.md TC-RATELIMIT-1.
  This is the highest-priority open item.
- **Manual browser smoke-test, per the Verification rules (docs/CLAUDE.md):** OTP flow
  (send → real email → verify → 6-10 digit code → session persists across popup close/reopen
  → logout), pending-state resume, full gating (logged-out page load produces zero extension
  DOM; expired-session silent refresh; toggle-time recheck; popup shows only login block when
  logged out), live activate/deactivate on login/logout (TC-AUTH-6/7), the three audit fixes
  (TC-PAT-CITY-1, TC-PAT-TIME-1), all three inline-panel CSS passes
  (TC-PANEL-WIDTH-1/2, TC-PANEL-POLISH-1), and the new "Shared refresh limit" toggle
  (TC-RATELIMIT-2) — none of the CSS/UI work has been visually confirmed at all yet. Run
  the six-item SMOKE CHECKLIST from docs/CLAUDE.md's Verification rules section and report
  pass/fail per item.
- **TC-AUTH-8 (activation lockout, B1)** — needs a browser pass with an induced
  `buildSidebar()` throw; the recovery step (failed activation → next attempt builds a working
  sidebar) is the one that actually proves the fix.
- **TC-AUTH-9 (local-first popup render + offline handling)** — steps 1, 2 and 6 are
  browser-only. Step 3 (offline while signed in) is the one that proves nobody gets signed out
  by a dropped connection; step 6 documents the ~25–30s late message on the expired+offline
  path so it is not mistaken for a hang.
- **Decide on deferring `supabase.min.js`** — reported, not implemented (CHANGELOG.md
  2026-07-30). Measure the bundle's evaluate-script cost first; the payoff is inferred.
- **Consider the same local-first treatment for `utils/authGate.js`** — it still does a network
  `setSession()` on every page load in every content script before features can activate. Not
  analysed in depth; flagged by the popup work.
- **Decide on the two adjacent issues left unfixed by the B1 fix:** (1) logout arriving while
  activation is in flight still builds a sidebar for a logged-out session — likely wants an
  `isAuthGateActiveSync()` recheck after the await; (2) `buildSidebar()`'s injected
  `<style data-testid="ext-sidebar-styles">` is never removed by `deactivateExtensionUI()`, so
  copies accumulate across deactivate→activate cycles. Both are cheap; both were out of the
  one-fix scope.
- **A user-visible failure signal for a failed activation** — the B1 fix logs to the console
  only, by explicit instruction. A dispatcher who hits it still sees nothing on screen; they
  just get a working retry path instead of a permanent lockout. Not yet approved as a task.
- Extend the "Torren Relay" rebrand to `utils/constants.js`'s `EXT_NAME` (on-page sidebar
  title) and the manifest `description` — tracked in BACKLOG.md.
- `docs/SAFETY.md` pass for the two new surfaces introduced by rate limiting — a background
  service worker, and a MAIN-world script patching `window.fetch`/`XMLHttpRequest.prototype`
  — flagged in CHANGELOG.md 2026-07-20 but not yet written up.
- Resolve the Fast Book blocker (see below) before any further commits touch
  `utils/constants.js` or `docs/SAFETY.md`.
- Non-US locale handling (city/address formats, API response differences) — blocked until
  real captured data from a non-`.com` domain exists (see BACKLOG.md).
- Stage 15–18: performance hardening, error-handling pass, safety audit (Stage 17 checklist in
  SAFETY.md is currently incomplete/stripped — needs restoring once Fast Book is resolved),
  final build + packaging.
- Memory-leak / caching audit items 3 and 5 (style/favicon injection idempotency re-check,
  confirm no onChanged listener re-registration on SPA nav) — still open per BACKLOG.md.
- Auto-restore Amazon filters after reload — planned, not started, needs its own SAFETY.md
  review before implementation (new DOM interaction site).
- Missing PAT/inline-panel fields, reported not implemented (2026-07-20 audit): per-segment
  payout, segment ID label, stop-level warnings (e.g. Road Restriction) — absent entirely;
  segment distance/duration shown only for multi-segment loads, not single-segment ones.

## Блокери / Blockers

- **RESOLVED 2026-08-12 — the whole reset problem:** both signals are gone with the accumulator.
  `searchAuditId` was disproven (changes per REQUEST); `originCities` fired during the normal
  staged load of the SAME search, wiping 51 ids mid-fill. Nothing accumulates, so nothing needs
  resetting. The two-saved-search-tab thrash is moot for the same reason.
- **RESOLVED 2026-08-13 — per-city counts are confirmed correct on a live board.** Full
  intersection (30/30, 28/28), zero unmatched, across several refresh cycles. The blocker on
  moving from log-only to filtering is cleared; that move is now a scoping decision, not an
  unknown.
- **RESOLVED 2026-08-13 — debug flags.** All five back to shipped state (`DEBUG_LEVEL = 1`, both
  `CAPTURE_RESPONSES` and both `CITY_ASSIGN_DEBUG` `false`). Diagnostic code retained and dormant.
- **⚠ THE ACTIVE BLOCKER — five harness suites red or crashing.** `cityaccum`, `cityscope`,
  `citydiag`, `cityassign` stub the summary panel as an ancestor, provide no `getElementById`, and
  use non-UUID fixture ids; `citydrop` drives the retired clone path and crashes. Green and
  current: `citysibling` (56), `citypiggy` (53). **Blocks every subsequent code change** — the
  next run's signal is unreadable until this is fixed. PLAN.md task 4.
- **`content/loadParser.js:124` unaudited** — same "first `div.load-list`" assumption that caused
  the 0/N bug, and it feeds highlighting and alerts, which the dispatcher DOES see. PLAN.md task 5.
- **Still unconfirmed from live logs (2026-08-06):** whether the 700 ms settle delay is right on
  a slow board, whether 150 mi is a sensible cutoff, and whether a real refresh buffers more than
  one `/search` response (api-samples.md §6.4). None of these blocked the join; all three need a
  real log before anything depends on them. **Risk is contained** — the feature ships off,
  mutates no DOM, and nothing consumes its output.
- **DEBUG FLAGS ARE CURRENTLY ON and the build is not shippable as-is:** `DEBUG_LEVEL = 3`,
  `CAPTURE_RESPONSES = true` (both copies), `CITY_ASSIGN_DEBUG = true` (both copies). While
  `CITY_ASSIGN_DEBUG` is on the **raw response body is transported** across postMessage (capped
  at 500 000 chars) for the id-shape probe — a deliberate, documented reversal of the "nothing is
  retained" property, valid only for the debug session. All five must go back to `1` / `false`
  before shipping.
- **🚫 Cross-tab rate limiting unverified in a real browser (2026-07-20, PRE-LAUNCH
  BLOCKER):** code-complete and verified with real functional tests at the logic level
  (18/18 + 4/4 — see above), but genuinely untested against Amazon's real infrastructure
  with real multiple tabs. The whole point of this feature is preventing a shared-IP
  failure mode that silently breaks the extension for everyone on that IP — shipping it
  unverified risks the exact failure it's meant to prevent, just with more moving parts.
  See docs/BACKLOG.md and docs/TEST_CASES.md TC-RATELIMIT-1. The 2026-07-30 follow-up
  (TC-RATELIMIT-2) makes the shared budget optional but defaults to ON — it does not
  resolve this blocker, it only adds an escape hatch for a dispatcher who wants it off.

- **Fast Book safety reversal (unresolved, flagged 2026-07-17):** an uncommitted change in the
  working tree empties `FORBIDDEN_SELECTORS` in `utils/constants.js` (previously
  `#rlb-book-btn`, `#rlb-book-trip-confirm-booking-btn`, `#book-btn-row`), adds a new
  `ALLOWED_CLICK_INTENTS.FAST_BOOK`, and edits `docs/SAFETY.md` to change "The extension NEVER
  books a load" to "CAN execute a booking sequence" on a Fast Book trigger. This reverses the
  project's core never-books-a-load safety guarantee and is not accounted for in any approved
  spec or changelog entry. Do not commit or build on top of this until the user explicitly
  confirms intent, scope, and review process for a booking feature. See SAFETY.md "Safety
  rules → Unsure about booking safety → ASK".

