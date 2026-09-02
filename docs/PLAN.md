# PLAN.md — ordered source of truth

Status key: **next** = ready to start | **in progress** = started, unfinished | **blocked** = waiting on a named thing | **done**
One task at a time, in this order. Detail lives in STATE.md / BACKLOG.md; sequence lives here.

---

## 30. AUTO-OPEN — FIXED 2026-08-20  **done**

Two measured failures, both closed. Evidence in CHANGELOG and BACKLOG 0y-FIXED.

1. **The recently-added card carries NO `div.load-card` class.** The panel resolved cards by that
   class in **THREE** places — the click handler, the load id, and the anchor check — and all
   three now use cityAssign's established **id-shape** rule via `resolveCardForNode()`.
   🔑 The rule is **REUSED, not copied**. ⚠ It does **not** anchor on
   `wo-card-header--highlighted`, which is a STATE class, not a card class.

2. **A card with a 0x0 box was being clicked before layout.** `hasLayoutBox()` gates the
   dispatch, with a bounded one-frame retry (`AUTO_OPEN_LAYOUT_ATTEMPTS = 10`) and a clean
   give-up. ⚠ rAF is suspended in background tabs, so the retry falls back to a 16 ms timer —
   without that, this fix would have hung every hidden tab silently.

Also: the dispatch is a constructed `MouseEvent` carrying the target's centre coordinates.
`HTMLElement.click()` takes no arguments, so every synthetic click had been landing at (0,0),
outside the target box. Still ONE click, same gates — `docs/SAFETY.md` Click 2 updated.

⚠ **PLAN 7b ordering is preserved exactly:** `openTopNewLoad()` still returns synchronously and
the retry lives inside the already-scheduled callback, so the loop still stops before any await.

📏 **TAB VISIBILITY IS NOT THE CAUSE** — measured in both foreground and background tabs, with
successes and failures in each. **Do not re-open that hypothesis.**

---

## 31. UNASSIGNED LOADS ARE "ALL" ONLY — 2026-08-20  **done**

A YORK, PA load appeared under the HEBRON, KY tab. Ihor: *a dispatcher who believes he is booking
near Hebron and is actually in New York is a serious problem, not a cosmetic one.*

Both categories of unassigned — never-captured and captured-but-out-of-range — are now hidden
from every city tab, shown under **All** with an *"Origin not determined"* marker, and **both**
counted on the All badge. The counter previously omitted the out-of-range category entirely.

🔑 **RULE 9 IS REFINED, NOT OVERTURNED.** Unassigned loads are still visible and still counted;
"visible" now means *in All*. See HANDOFF §4 rule **9a** for Ihor's reasoning. A future change
that restores "never hidden" re-creates this defect.

⚠ **`CITY_ASSIGN_MAX_MILES` was NOT changed — that is PLAN 16 and Ihor has not decided it.**
City membership is also unchanged: every active city within the max, **not** nearest-wins, so a
load in range of two cities still appears under both.

A flag-gated `CITY WHY-UNASSIGNED` line now reports, per unassigned load, its coordinates, the
distance to **every** active city, the nearest and by how much it misses — or, with no
coordinates, which lookup came back empty and which endpoint listed it.

---

## 33. MINIMUM OPERATING RADIUS — 25 mi floor, 2026-08-24  **done**

Ihor's product decision, from a live measurement: at radius **10 mi** Amazon still returned
**JAX3 at 13.64 mi** and **DAL2 at 16.15 mi**, and judging them by his raw 10 stranded both on
the All tab marked *"Origin not determined"*.

🔑 **Amazon relaxes proximity below 25 mi and respects the boundary at or above it**, so city
membership uses `effectiveRadius = Math.max(hisRadius, 25)`. At 50 mi nothing changes.

⚠ **MEMBERSHIP ONLY** — the search request, the captured radius and the payload sent to Amazon
are untouched, and `CITY_ASSIGN_MAX_MILES` fallback logic is unchanged and not clamped.
`computeAssignment()` stays synchronous. Diagnostics print `25 (clamped from 10)`, never the
clamped number alone.

---

## 32. PER-CITY SEARCH RADIUS — BOTH PARTS DONE 2026-08-20  **done**

Supersedes the `CITY_ASSIGN_MAX_MILES` half of PLAN 16.

**PART 1 — DONE.** The `/api/loadboard/search` REQUEST body is captured. The `window.fetch`
wrapper already received `arguments[1]` and read `init.signal`; it now reads `init.body` beside
it, for `WATCH_PATH` only. 🔑 **The response machinery (api-samples §6.8) is untouched** — there
is no clone and no tee, because `init.body` is a plain string already in hand. A non-string body
**stops and reports**; no `Request` is ever cloned.

✅ **PART 2 — DONE.** The field is **`radius`**, a **bare number**, one per city. Membership uses
each city's own value, matched to our active origin cities by **haversine distance within 15 mi**
— never by name (localised) or country (⚠ **TULSA carried `country: null`** live). The two
coordinate sources differ by ~4 mi, which is what the bound absorbs; an **ambiguous** match is
**refused**, never guessed.

🔑 **THE ACCEPTANCE CRITERION — the All badge must be EMPTY, and is now a SELF-CHECK.** Amazon
only returns loads already inside his radius of a selected city, so every returned load belongs to
at least one city. **⚠ A count on that badge is a BUG — our radius has diverged from Amazon's —
NOT expected noise.** The board's total load count must not change at all; only which tab each
load appears under.

🔴 **STILL OPEN: the radius UNIT is implicit.** A bare number, `.com`-only captures; on a metric
domain every range would be ~38% short. No conversion is performed, non-`.com` boards are flagged,
and closing it needs a non-`.com` capture — BACKLOG 0ad, and the same artefact PLAN 21 requires.

**`CITY_ASSIGN_MAX_MILES` is KEPT as a labelled last resort**, not deleted: an unreadable radius
would otherwise have to mean "assign to nothing" or "assign to everything". It announces itself.

⚠ **The radius is PER CITY, not one value for the search.** That corrects an assumption we had
been working under.

⚠ **When Part 2 lands:** membership uses each city's **own** radius; semantics are otherwise
unchanged (every city in range, **not** nearest-wins); the unit comes **from the data**, never
assumed; and an unreadable radius is **reported, never silently defaulted to 150** — that would
reinstate the exact defect.

---

## 🔴 LAUNCH BLOCKERS — audited 2026-08-24. Not features; the package does not pass without them.

| # | blocker | closes when |
|---|---|---|
| **B1** | ⚠ **PARTLY RESOLVED 2026-08-26.** Both flags now read `1` / `false` and the suite is green (2433/0) — **but the change is UNCOMMITTED**, so the history at b1b4c96 still builds a debug extension | commit `utils/constants.js`. ✅ `capture-suite` already went green **by the flag being FIXED, not silenced** |
| **B2** | `manifest.json` has **no `icons`**, no `action.default_icon`, and there is **no PNG in the repo** | 16/32/48/128 px committed and declared |
| **B3** | `scripting` permission requested, `chrome.scripting` used **0 times** | remove it; verify `activeTab` and `clipboardWrite` the same way |
| **B4** | P/R detection is a DOM dependency and the **R branch has never executed** — only P has ever been captured | a labelled R capture (BACKLOG 0p), or an explicit decision to ship the DOM read |
| **B5** | The radius **unit is implicit** — bare number, `.com`-only captures; a metric board would be ~38% short | a non-`.com` capture (PLAN 21 / BACKLOG 0ad), or ship US-only and say so |
| **B6** | **Nothing built since 2026-08-20 has been seen on a real board** | Ihor runs the checks in STATE.md |

⚠ **B2–B3 are small edits and were deliberately NOT made** — the 2026-08-24 pass was an audit. B1 was fixed by Ihor on 2026-08-26 but is not yet committed.
⚠ **B4 and B5 are shippable WITH a stated limitation if Ihor accepts them. That is his call.**

---

## Before launch

1. **Live DOM capture — main vs similar list.** **done** (2026-08-13). Structure recorded in `AMAZON_SELECTORS.md`: the summary panel is a **sibling** of the results, not a container.
2. **Fix `findMainResultsList` to the captured selector.** **done** (2026-08-13), live-verified under task 3. Anchors on `#search-results-summary-panel` and walks following siblings; card ids collected by UUID shape rather than card class.
3. **Live verify per-cycle cityAssign.** **done** (2026-08-13). Across several auto-refresh cycles: `CITY DIAG 0/5` MATCH: YES every cycle, `CITY DIAG 3/4` intersection **full (30/30, 28/28)**, zero unmatched, zero RESET lines, and the board rendered normally with the `Response.prototype` wrapper in place. Required capturing via Amazon's own `Response.json()` read — the SPA's abort kills any cloned read (api-samples.md §6.8). All five debug flags returned to shipped state afterwards.
4. **Rebuild the harness suites on the real DOM structure.** **done** (2026-08-13). Seven suites retired (six obsolete or fixture-broken — including `cityraw-harness`, a sixth not in the original scope — plus two green ones now subsumed); replaced by a shared `fixtures.mjs` modelling the live-captured board and two suites: `cityassign-suite` (91) and `capture-suite` (64). **155 green, 0 red.** Zero production changes. One cosmetic diagnostic defect found and deliberately left unfixed, recorded as a passing assertion — see CHANGELOG.
5. **Audit `loadParser.js:124`** — same "first `div.load-list`" assumption, feeds highlight and sound. **done** (2026-08-13). Audit found it was **not** reading Similar-matches cards (document order put main first and collection was already scoped), so this was hardening rather than a bug fix — the lookup now anchors on the summary panel and walks following siblings, with a fallback to the old behaviour on panel-missing so the alert can never go silent. The suspected silent alert-miss was also **disproved**: a live 10-of-10 capture showed the recently-added card carries `div.wo-card-header--highlighted`, which the existing selector list already matches. 49 new checks; 204 green overall.
6. **cityAssign: log-only → actually filtering cards.** **built and shipping — awaiting Ihor's live confirmation** (2026-08-13). Filtering works end to end in the tests and is on by default (`CITY_FILTER_ENABLED` is a PRODUCT flag). NOT marked done: this is one of the two items only Ihor's eyes can close. *Verify: card count per city matches what I count on the board by eye; nothing else on the board moves.*
7. **Wire the city-button click to per-city filtering.** **built and shipping — awaiting Ihor's live confirmation** (2026-08-13), extended by 7c. Single-select: a click filters to that city, clicking the active one returns to All. **NOT marked done — only Ihor's eyes can close it, and there is no browser here.** *Verify: one click on a city shows only that city's loads; click again returns all.*
7b. **Auto-open stops the refresh loop TOO LATE — the accordion closes after ~1s.** **done** (2026-08-13). The stop moved ahead of `await sleep(800)` on both the new-load and surge branches, matching the manual-click path. Needed a companion change: `shouldContinue()` is `gateActive && running`, so the post-await checkpoints switched to a new gate-only `gateStillOpen()` — otherwise stopping first would have bailed and destroyed the panel. A failed or abandoned open still leaves the sidebar showing the stopped state, exactly as a manual click does. 41 new checks; 440 green overall. *Live-verify: an auto-opened load stays open until I act on it.*
7c. **Auto-switch the city filter when a new load arrives elsewhere.** built, **awaiting live confirmation** (2026-08-13). Ihor's decision, reversing the earlier same-day "badge only, never switch": a new load in a non-active city now pulls the view to that city and is opened like any visible load. Anchored on `ordered[0]` so the switch and the auto-open always agree; other cities stay badged. Uses `selectCityFilter()` — the button's own handler — so a switch cannot drift from a click. New `dispatcherIsMidWork()` blocks it while a panel is open or the loop is stopped; "All" never switches; PLAN 7b ordering holds. 83 new checks; 524 green overall. The **surge branch was deliberately not touched** — it still has no filter awareness; decide separately. *Live-verify: sit on one city, wait for a load elsewhere, confirm the view moves and the panel stays; then repeat while reading a manually opened load and confirm nothing moves.*
7d. **ARCHITECTURE: read a card's origin city from the CARD, not the network capture.** **SUPERSEDED — FAILED LIVE, reverted the same day by 7e** (2026-08-13). Recorded so the approach is not reinvented. It replaced the captured coordinates with the card's own first-stop text (`span[tabindex="0"] span.wo-card-header__components`) geocoded through `resolvePATCity`. On the live board it left **every card unassigned** — the HEBRON and COLUMBUS tabs showed identical lists. ⚠ **Do not parse addresses, ZIPs, city names or facility codes off a card to determine its city.** The lasting gains from that task were kept by 7e: the SCOPE guard is diagnostics-only, and the rAF-coalesced re-render observer removed the 700 ms un-filtered flash. *No verify step — this task no longer exists in the code.*
7e. **Revert to Amazon's own coordinates; fix the DELIVERY layer.** built, **awaiting live confirmation** (2026-08-13). Task 7d failed live — HEBRON and COLUMBUS showed identical lists, every card unassigned — so the DOM-origin reader and per-load geocoding are removed. The city again comes from `stops[0].location.latitude/.longitude` joined by work-opportunity id, through a **merged** map fed by every buffered response that **persists across cycles** (bounded 4000, oldest evicted). `pickBuffer()` is no longer called; the 4-response cap can no longer lose an assignment; no cycle-skipping. Merge safety measured against `samples/`: 13 repeated ids, 13 identical coordinates, 0 conflicts. New unassigned counter on the All button so this class of failure can never again look like a working filter. 71 new checks; 689 green. *Live-verify: on a >50 board the `CITY ASSIGN` line reads coverage N/N and the All button shows no counter; the two city tabs show DIFFERENT lists.*
7f. **Per-page working set — assignment and filtering follow the rendered page.** built, **awaiting live confirmation** (2026-08-13). Ihor's rule: work only with the loads currently rendered. Fixes filtering degrading past 50 results, where the re-render path's MERGE left the previous page's assignments in the map while the board showed different loads. A page change now replaces the map; an ordinary re-render still merges. Detected from the "Showing 51 - 100 of 145" range plus the first/last rendered ids — never from the page controls, which we never touch. Coordinates persist across pages, so returning to page 1 re-filters from memory with no new request. Observer re-attach added: a detached observer would stop noticing pagination silently. Established from captures: **one /search response = one page** (max 50 records), so page 2 needs its own request. 59 new checks; 868 green. *Live-verify: on a 3-page board, each page filters correctly and coverage reads N/N per page.*
8. **Post-a-Truck: R-type (own-trailer) support.** ✅ **CLOSED 2026-08-20** — Ihor confirmed PAT working on both a P and an R load; smoke item (e) PASSES. The one caveat is not a blocker and is tracked separately: trailer ownership is an authorised INTERIM DOM DEPENDENCY (BACKLOG 0p), to be replaced when the record-based rule is found. — PRIOR: **IMPLEMENTED 2026-08-20, NOT CLOSED.** PAT now posts `CARRIER_OWNED` for an R load and `AMAZON_PROVIDED` for a P load, derived from the card's badge letter. **It stays OPEN for two reasons:** (1) the R branch is UNVERIFIED — "R" appears in no captured card, so Ihor must confirm a real R post on Amazon; and (2) the source is an authorised INTERIM DOM DEPENDENCY, the only non-record field in the payload, which must be replaced when the record-based rule is found (label collection is now running to find it) or when Ihor's backend supplies ownership directly. Closing this task means both are done. — PRIOR STATE: **blocked on DETECTION (2026-08-19).** Eleven real upserts (api-samples 8) settled the enums: providedTrailerType is exactly "AMAZON_PROVIDED" or "CARRIER_OWNED", always equal to visibleProvidedTrailerType. **The payload side is done.** What blocks it is that the search response does not say which a load is: measured across 159 work opportunities / 506 stops, no path carries either enum or a bare P/R, and the PLAN 29f candidate `trailerDetails[].assetOwner` is DISQUALIFIED because 42 of 159 loads carry two different owners across their own stops (api-samples 9). **Needs: the /search response for an R-badge load and for a P-badge load.** See BACKLOG 0p. ✅ The 53' Trailer gap is CLOSED (2026-08-19): the expanded array was captured twice and is byte-identical to PAT_EQUIPMENT_TYPES_53, so no change was needed (BACKLOG 0r). PLAN 8's remaining blocker is DETECTION alone. ⚠ FIFTY_THREE_FOOT_REEFER_TRUCK is still uncaptured and refuses to post. *Verify: PAT footer on an R load no longer says "(Provided)", and a real R post goes through.*
9. **Correct stale claims in `api-samples.md` §6.5 / §6.7.** **done** (2026-08-17). §6.5's "page size 50" and §6.7's "paginates at 5" were BOTH wrong: measured across every capture, page size is not fixed — 4, 5 and 50 all observed. What is stable is "at most 50 per response, and never hardcode it — read the rendered range". Corrected in `api-samples.md` and `AMAZON_SELECTORS.md`, and recorded in HANDOFF §7. *Verify: nothing on screen — docs only.*
10. ✅ **CLOSED 2026-08-20 BY PRODUCT DECISION — the four-tab test is NO LONGER REQUIRED.** Ihor removed the "Shared refresh limit" toggle and the feature now ships OFF: silently slowing refreshes while the bar says "Refresh every 2.5s" reads as broken, not as protection. **With the shared limit off there is no aggregate-rate behaviour left to test across tabs**, so the four-tab aggregate requirement is retired. The machinery is intact and unreachable (BACKLOG 0s), one constant re-enables it, and ⚠ backoff is untouched and still pauses every tab. What replaced the test: **D2** the loop now STOPS by itself on **three CONSECUTIVE** 429/502/503/504 responses (2026-08-20 follow-up — an isolated 502 must not stop the board), in every tab, and never auto-restarts. Backoff still engages on the FIRST response: backoff and stop are deliberately decoupled. The counter is the existing `backoffStepIndex`, not a new field; **D3** a calm message appears in the TOP BAR and clears when the dispatcher restarts. Covered by TC-RATE-PAUSE in one tab. — PRIOR: **[INSTRUMENTED 2026-08-20 — ready for Ihor's four-tab run.]** The mechanism was read from source first and it is sound: one global `lastGrantedAt` floor in `chrome.storage.local`, FIFO through `permitQueueTail`, re-read after every wait, with backoff checked BEFORE the shared-limit toggle so a rate-limit status pauses every tab either way. **The aggregate rate CAN hold as built — no defect.** There is no token/lease/turn: it is a permit with a global floor, first-come-first-served. Diagnostics added (flag-gated, no behaviour change) so the aggregate is visible from ANY ONE console: `__EXT_DEBUG.rateDiagOn()` / `rateDiag()` / `rateDiagOff()`. The 503 pause is triggered ONLY by an HTTP status in `RATE_LIMIT_STATUSES = [429,502,503,504]` inside `reportResult()` — ⚠ **DevTools request blocking does NOT trigger it** (no status, different branch, and aborts are not reported at all), so `__EXT_DEBUG.simulateRateLimit()` was added: it calls the REAL `reportResult()`, proving pause/backoff/propagation/resume but NOT the networkObserver→content relay. `WATCH_PATH` confirmed still search-only. See CHANGELOG 2026-08-20 and TEST_CASES TC-RATE-4TAB. — ORIGINAL: **Cross-tab rate limiting — live multi-tab test (🚫 pre-launch blocker).** next. *Verify: 4 tabs open, aggregate request rate equals the global interval, not 4×; a forced 503 pauses and resumes all tabs together.*
11. **Full manual smoke pass + outstanding TEST_CASES.** blocked (on Ihor running it). **Never run for this entire phase** — every change since 2026-08-13 reports the six items as NOT RUN. This is the single highest-value thing Ihor can do next. *Verify: all six smoke items pass — popup opens clean, logged-out popup shows only login, full login flow, sidebar activates, PAT modal Confirm enables, no page-console errors.*
12. **All five debug flags back OFF, final build check.** blocked (on 11). ⚠ **`DEBUG_LEVEL` is currently `3` and must return to `1`.** The other four flags are already off; `CITY_FILTER_ENABLED` is a PRODUCT flag and stays `true`. *Verify: at stock level the console shows no CITY / capture lines at all.*
13. **Store submission package** — manifest description copy, icons 16/32/48/128, privacy policy page, listing materials, data disclosure, version bump, zip. next (non-code). *Verify: I load the zipped build unpacked and it behaves exactly like the working tree.*

---

## Post-launch / unscheduled

> ✅ **2026-08-28 — the PAT origin radius "defect" is CLOSED AS CORRECT BEHAVIOUR** (BACKLOG 0aq),
> by Ihor's product decision. A Post-a-Truck is anchored to the **pickup of the load being taken**,
> not to the driver's home city, so a 25-mile default is right and the dropdown covers the rest.
> ⚠ **`MIN_OPERATING_RADIUS` was DISPROVED as the cause and does not reach the payload; the
> per-city search radius is available at PAT time and is deliberately NOT used.** Do not "fix" it.

14. **Multi-Driver Monitor UI** — driver sub-tabs, per-driver new-load counter, colour stripe on the "All" view. *Verify: a new load for one driver highlights that driver's tab and flashes the card.*
15. **Re-capture the five-city response into `samples/`, re-confirm findings 1, 3, 4.** *Verify: nothing on screen — a file exists and matches.*
16. **Tune `CITY_ASSIGN_MAX_MILES` (150) and `CITY_ASSIGN_SETTLE_MS` (700) against real logs.** *Verify: no load lands in the wrong city and none goes unmatched on a normal board.*

    🔴 **2026-08-20 — MEASURED WRONG IN BOTH DIRECTIONS. Ihor is right, and 150 is not tunable to a correct value because it is the wrong KIND of number.** With his radius at **250**, six loads at **151–222 mi** were marked *"Origin not determined"* — Amazon returned them legitimately. With his radius at **50**, a load **122 mi** from HEBRON appeared under the HEBRON tab. The limit must follow the radius **he** sets, which is **one value for the whole search — not per city**.

    ⚠ **Reading that radius is genuinely hard, and the cost was measured before anything was built (BACKLOG 0ab, 2026-08-20 — diagnostic only, nothing changed).** In short: **no capture of a load-board radius control exists anywhere on disk**; Amazon **unmounts** the filter panel when collapsed and **we collapse it ourselves on every loop START**, so a control living there is *absent*, not merely fragile; and whether the `/api/loadboard/search` **request** carries the radius **cannot be known without capturing one** — we have never captured a request body.

    🔑 **The cheapest source may already be in memory.** The `/search` response carries `deadhead: { value, unit }` per load — Amazon's own distance to the **nearest** selected origin city — so every returned load is within the radius by definition, and `max(deadhead)` is a **lower bound** needing no DOM read and no new capture. It cannot say *which* cities a load is in range of, so it does not replace the limit; it does fix the false-negative half outright.

    ⚠ **"Fall back to 150" is not an acceptable fallback** — it silently re-creates the defect. Any fallback must be visible.

    ✅ **2026-08-20 — SUPERSEDED, not closed.** `CITY_ASSIGN_SETTLE_MS` (700) still wants tuning and stays here. But `CITY_ASSIGN_MAX_MILES` is **no longer a number to tune** — Ihor captured the `/search` REQUEST body and the dispatcher's radius is in it, **per city**. Tuning a global guess toward a per-city value the API already states would be the wrong exercise. See **PLAN 32**.

    **The constant is untouched for now.** What becomes of it is a Part 2 decision, and the honest options are: **delete it**, or **keep it as a clearly-labelled last-resort bound used only when the radius cannot be read — and only alongside the visible warning, never silently.**
17. **Persist the city-coordinate cache across page reloads.** *Verify: after a reload the city panel fills without a visible delay.*
18. **Split the ~400 flag-gated diagnostic lines out of `cityAssign.js`.** *Verify: nothing on screen — ergonomics only.*
19. **Collapse Amazon's left filters panel on START.** blocked (no reliable read of open vs collapsed). *Verify: pressing START collapses the panel and never re-opens it.*
20. **Price-increase payout selector** (`__modified-load-increase-attr`). blocked (needs one capture of a price-increased card). *Verify: payout shows on a price-increased card instead of the "could not be read" warning.*
21. **Non-US locale handling.** blocked (needs a capture from a non-`.com` domain). *Verify: board on a non-US domain parses cities and addresses correctly.*
22. **Auto-restore Amazon filters after reload.** *Verify: my filters come back after a page reload.*
23. **Memory-leak / caching audit items 3 and 5.** *Verify: memory indicator stays flat over a long session.*
24. **Missing PAT / inline-panel fields** — per-segment payout, segment ID label, stop-level warnings. *Verify: those fields appear in the panel where the board shows them.*
25. **B1 follow-ups** — logout arriving mid-activation; `ext-sidebar-styles` never removed on teardown. *Verify: repeated login→logout cycles leave no duplicate styles and no sidebar for a logged-out session.*
26. **Status-handling decisions** — sustained 404 loud log, 401/403 auth re-check instead of backoff. *Verify: nothing on screen normally; a stale watch path becomes visible in the console.*
27. **`supabase.min.js` deferral + `authGate.js` local-first.** measure before deciding. *Verify: popup and page activation feel no slower and nobody gets logged out.*
28. **`SAFETY.md` pass for the two new surfaces** — background service worker, MAIN-world fetch/XHR observer. *Verify: nothing on screen — docs only.*
34. **Chat button on the load card — 1.1 candidate, NOT STARTED.** Open Amazon's negotiation chat bound to **that** load. Today the chat opens on the **topmost negotiable load**, so reaching the third one means opening and closing it three times. Ihor reports competitors have this, so it is feasible; **HOW is unknown.** 🔴 **BLOCKED on a Network capture from Ihor:** which requests fire when the chat button is pressed, whether any carries a work-opportunity id, and whether the URL changes. ⚠ **If no load id is passed the feature is not possible as described — establish that before any design.** See BACKLOG 0ar. *Verify: pressing chat on the third negotiable load opens that load's chat, not the topmost one.*
35. **Quick-phrase inserts for negotiation chat — 1.1 candidate, NOT STARTED.** 10-15 canned dispatcher phrases inserted with one click instead of typing. ⚠ **Depends entirely on item 34** — with no per-load chat there is nothing to insert into. See BACKLOG 0as. *Verify: one click drops the chosen phrase into the chat box, ready to send.*

---

## 29. INLINE PANEL FROM CAPTURED API DATA (Ihor, 2026-08-13)

Render the accordion from the captured `/search`, `/similar` and `/recommendations/get` bodies
instead of clicking a card and scraping Amazon's detail sheet. **Booking stays entirely Amazon's —
the panel is informational and never books.**

**Field coverage was measured first, against the captures on disk — 154 records, 484 stops.**
Every field the panel shows today is covered except one, which is derivable. Full table in
CHANGELOG (2026-08-14) and §29.1 below.

29a. **Stage A — REMOVAL FIRST.** **done** (2026-08-14). **Removed:** `waitForSheet()`, `cancelSheetPoll()`, `sheetFingerprint()`, `readSheetData()`, `parseStopBlock()` and every `.css-<hash>` selector they carried (338 lines from `content/inlinePanel.js`), the poller state, the sheet-poll call in the manual handler, and `await sleep(800)` plus both `showInlinePanel()` calls in `content/content.js`. **KEPT against the brief — `SHEET_SELECTOR`:** Fast Book reads Amazon's LIVE sheet through it to find the Book button, so removing it would have broken Fast Book. Its load id comes from the CARD, never the scrape, so that half needed nothing. **No regression, per Ihor:** the manual handler never intercepted the click — no `preventDefault`, no `stopPropagation`, no programmatic click — so Amazon's own detail sheet opens exactly as it would with the extension uninstalled. The fallback holds by construction, not by a branch anyone has to keep correct. **Untouched:** the dispatcher's click and its stop-the-loop, START/STOP, 7b ordering (now trivially true — nothing awaits after the stop), the auto-switch, `enforcePanelAnchor()`, the `data-load-id` binding, detection, alert, filtering, PAT. ⚠ **No panel renders until Stage B.** `gateStillOpen()` is orphaned and marked so, not deleted. 56 new checks; 1134 green. *Verify: clicking a card opens AMAZON'S sheet and still stops the loop; no `.css-` string remains in inlinePanel.js; Fast Book still books.*  🔴 **CAUSED A REGRESSION — Post-a-Truck is broken (confirmed live 2026-08-19).** PAT read its stop count and load times from the sheet this task removed. Smoke item (e) now FAILS. Tracked as PLAN 30 / BACKLOG 0h. This task is NOT to be re-opened or reverted — the removal was correct; the fix is to re-source PAT from the captured projection.
29b. **Stage B — RENDER FROM DATA.** **done** (2026-08-14). ⚠ **Shipped unwired and was fixed the same day** — `showInlinePanel()` had no caller, because Stage A removed it from the manual handler and this stage never restored it; 1220 green tests included one asserting the absence. Now wired, with a `PANEL GATE` trace and `wiring-suite`, which dispatches a real click end to end. The panel is built from the load's own captured record, keyed by work-opportunity id, inserted under that id's card. **Source:** a CURATED projection emitted by `projectRecord()` in `networkObserver.js` — an explicit field list, never the raw body: 772 bytes/record, 41.6 KB for a 50-record page against 299.8 KB raw (13.9%). Stored in `_cityRecordById`, evicted with the coordinates from one shared order list, cleared on teardown. **Four binding rules, each returning false:** no id on the card; no record for that id (**no interception — Amazon's own sheet opens**); id not in the rendered main list or hidden by the city filter (`visibleAnchorFor`); otherwise render. **Segments iterate `loads[]`** — verified as segment order four independent ways on all 71 multi-load records (chained stop codes, non-decreasing first CHECKIN, non-decreasing last CHECKOUT, rising `stopSequenceNumber`). **Times render in STOP-LOCAL time** via each stop's own `location.timeZone` — 31% of records span two zones, so one zone per load would be wrong on a third of them. Segment duration DERIVED (last CHECKOUT − first CHECKIN), which closes Stage E. 83 new checks; 1220 green. *Verify: open a single-leg and a multi-leg load and read the panel against Amazon's own sheet side by side — the arrival/departure times must match exactly.*
29c. **Stage C — WIRE INTO AUTO-OPEN.** ✅ **DE FACTO CLOSED — traced 2026-08-27, source only.**

    🔑 **EVIDENCE.** Auto-open never needed its own render call: its synthetic click bubbles to
    the SAME delegated handler a real click uses, and that handler renders the panel.
    `detailOpener.js:201-214` builds `new MouseEvent('click', { bubbles: true, ... })` and
    calls `target.dispatchEvent(ev)`; it bubbles to the `document` listener registered at
    `inlinePanel.js:1753`, which resolves the card at `:1757` and calls
    `showInlinePanel(card)` at `:1859`. **Nothing anywhere checks `event.isTrusted`** —
    the only two occurrences (`detailOpener.js:469`, `:609`) READ it for a diagnostic line
    and never branch on it.

    ⚠ **THE OLD "zero showInlinePanel calls in content.js" OBSERVATION IS STILL LITERALLY TRUE**
    — and the inference drawn from it was wrong. The render happens through the shared handler,
    not through a call in `content.js`. Ihor reports live (2026-08-24) that the panel appears
    after auto-open every time, which matches this trace.

    ⚠ **NOT GUARANTEED BY CONSTRUCTION — one branch does not render.** `detailOpener.js:161-166`
    falls back to dispatching at the CARD CONTAINER when `elementFromPoint` resolves outside
    the card; the container guard at `inlinePanel.js:1787` then rejects exactly that click.
    On the normal path the hit-test point (30% width, 50% height of the card,
    `detailOpener.js:133-135`) lands on a descendant and the guard passes. **Whether the
    fallback ever fires on a real board is UNMEASURED.**

    **Remaining before this is called closed outright:** confirm the fallback is not firing —
    the `resolved target outside card, falling back to card element` warning must be absent
    from the console across a run of auto-opens.

    *Original goal, unchanged: opens with no fixed delay; the loop still stops before any await (7b).*
29d. **Stage D — MEASURE.** blocked (on 29c). Log detection -> panel-visible in ms, before and after, so the gain is a number rather than an impression. *Verify: one console line per open reading `panel ready in Nms`; N is well under the 800 it replaces.*
29e. **Stage E — the one MISSING field.** **done** (2026-08-14, delivered inside Stage B). Per-segment **duration** has no field on `loads[]` (only `layoverDuration`). Derive it from `stops[].actions[]`: last `CHECKOUT.plannedTime` − first `CHECKIN.plannedTime`. Show nothing rather than a guess if either is absent. *Verify: a multi-leg load shows a duration per leg, and the sum is consistent with `totalDuration`.*
29f. **Stage F — the fields we do NOT show yet.** next. Deliberately excluded from Stage B so they are added on purpose, not by drift. All present and measured (§29.1): `aggregatedCostItems[]` (Base Rate / Fuel Surcharge / Toll Charge), `loads[i].specialServices[]` (`SWING_DOOR`, `SLIDE_TANDEMS`, `STRAPS`, `LUMPER`), `totalLayover` (non-zero on 21 of 154), `loads[i].equipmentType` (already projected, not yet rendered), `stops[j].trailerDetails[].assetOwner`, `stops[j].pickupInstructions` / `.deliveryInstructions`, `stops[j].weight`, `stops[j].stopCategory`, `deadhead`, `firstPickupTime` / `lastDeliveryTime`, `workOpportunityArrivalWindows[]`, `transitOperatorType`. Each needs a projection field AND a render slot. *Verify: a load with SWING_DOOR or a non-zero layover shows it; a plain load shows no empty rows.*

### 29.1 Coverage, measured — not assumed

| Panel field today | JSON path | Status |
|---|---|---|
| stops count | `stopCount` | ✅ 100% |
| total miles | `totalDistance.value` / `.unit` | ✅ 100% |
| payout | `payout.value` / `.unit` | ✅ 100% |
| segment from → to | `loads[i].stops[0].location.label` → `loads[i].stops[n].location.label` | ✅ 100% |
| segment miles | `loads[i].distance.value` | ✅ 100% |
| segment duration | — | ⚠️ **DERIVE** (Stage E) |
| segment loaded / loadType | `loads[i].loadType` (`LOADED` \| `EMPTY`) | ✅ 100% |
| stop number | `stops[j].stopSequenceNumber` | ✅ 100% |
| stop name | `stops[j].location.label` / `.stopCode` | ✅ 100% |
| stop address | `stops[j].location.line1` + `.city` + `.state` + `.postalCode` | ✅ 100% |
| **stop arrival** | `stops[j].actions[type=CHECKIN].plannedTime` | ✅ **484/484 stops, 0 null** |
| **stop departure** | `stops[j].actions[type=CHECKOUT].plannedTime` | ✅ **484/484 stops, 0 null** |
| stop load type | `stops[j].loadingType` / `.unloadingType` | ✅ present (null on legs where it does not apply) |

**Nothing is worth keeping the click for.** The single gap is per-segment duration, and it is
arithmetic on data we already hold — not a reason to keep an 800 ms scrape.

**Not shown today, all present:** `aggregatedCostItems[]` (Base Rate / Fuel Surcharge / Toll
Charge), `deadhead.value`, `loads[i].equipmentType`, `stops[j].trailerDetails[].assetOwner`,
`loads[i].specialServices[]` (`SWING_DOOR`, `SLIDE_TANDEMS`, `STRAPS`, `LUMPER` all seen),
`totalLayover` (non-zero on 21 of 154), `firstPickupTime`, `lastDeliveryTime`,
`workOpportunityArrivalWindows[]`, `stops[j].weight`, `stops[j].stopCategory`,
`stops[j].pickupInstructions` / `.deliveryInstructions`, `transitOperatorType`.

**Multi-leg is real and must be handled:** up to **3** `loads[]` per record and **4** `stops[]`
per load were measured. Segments map to `loads[]`, not to a fixed two-stop shape.

### 29.2 Risks — decide these before Stage B

1. **A load is rendered but its record is in no captured buffer.** Happens when the response
   landed before the extension activated. The panel must show **nothing** — no panel at all,
   consistent with 29b's "no record, no panel" rule — never a half-filled panel, which would look
   like real data. The unmatched badge already surfaces this class of card.
2. **What an unmatched load shows.** Today the dispatcher gets Amazon's own sheet by clicking.
   After Stage A that fallback is gone, so an unmatched card must open **nothing** and say why in
   the console. **This is the one real regression in the whole plan** and Ihor should confirm he
   accepts it before Stage A runs.
3. **Does removing the click change anything he relies on?** The click that opens Amazon's own
   detail sheet is the dispatcher's, and it stays. What goes is OUR programmatic click used only
   to harvest data. Worth confirming live that nothing else keys off the sheet being open —
   Fast Book reads `sheetLoadId`, and that path must be re-checked in Stage A rather than assumed.
4. **`loads[]` ordering.** Segment order is assumed to be `loads[]` order; not verified against a
30. **Re-source Post-a-Truck from the captured projection.** **BUILT 2026-08-19 — awaiting Ihor's re-test of smoke item (e).** Follow-up the same day fixed three things found live: the `equipment` ReferenceError that stopped the modal appearing at all; the async silent-failure class that hid it (top-level catch + visible failure dialog + caller handles the rejection); and the loading type, now the FIXED "Live or Drop & Hook" for every load by Ihor's product decision (`resolveLoadingType` deleted). `patmodal-suite` invokes `openPostModal()` end to end — 154/154 captured records open a modal. A further fix the same day normalised the stop STATE to a two-letter code (`PAT_STATE_CODE_BY_NAME`, 50 states + DC + 13 Canadian provinces, no fuzzy fallback): the record carries both forms in one field, 454 code / 52 name across 506 stops, and `resolvePATCity` matches only codes — which is why «MONROE, Ohio» could not resolve. Two live defects remain open as separate tasks: Team posting as Solo, and R posting as Provided (BACKLOG 0m, 0n). **0m diagnosed 2026-08-19:** the driver type is hardcoded in `patApi.js:387` and `patModal.js:1129`, has never been load-derived (one commit, `512381d`), and is therefore a long-standing defect rather than a regression. `transitOperatorType` is the only candidate field and reads `SINGLE_DRIVER` in 159/159 captures, so **two captures are required before it can be fixed** — a known team load's `/search` response and a manual PAT upsert with Team selected. `PATDIAG DRIVER` collected the first: Ihor measured `TEAM_DRIVER` live on load d075a306, and on 2026-08-19 he captured a real upsert payload (api-samples §7) that closed it. **PLAN 8 (equipment types) is now PARTLY UNBLOCKED:** `TWENTY_SIX_FOOT_BOX_TRUCK` is capture-confirmed and mapped; `FORTY_FOOT_CONTAINER` remains uncaptured and unmapped, so PLAN 8 is **NOT closed** — it still waits on a 40' Container capture. The same capture confirmed `CARRIER_OWNED`, but P/R stays blocked on DETECTION (BACKLOG 0n), not on constants. **0m half fixed 2026-08-19** — the driver type is now derived from `transitOperatorType`, the modal shows it read-only, and a team load is detected and BLOCKED rather than posting as solo. Only the upsert's team `driverTypes` value is still unknown; one capture of a manual PAT post with Team selected closes it. Implemented per Ihor's architectural directive: PAT reads `getLoadRecord(loadId)` and no page DOM at all. D1 start = first `checkIn` −30 min; D2 end = last `checkOut` +3 h; D3 stop count = `record.stopCount`; D4 real ISO instant + IANA zone (year-guessing and the fixed offset table removed). ×1.10 markup and ±25-mile window unchanged. Equipment mapped by ENUM, never by display label; unmapped enums logged verbatim and routed to the existing unsupported path. 62 new checks; 154/154 captured records resolve with nothing missing. *Verify: TC-PAT-RECORD.* — ORIGINAL ENTRY: **PAT was broken** (regression from 29a, confirmed live 2026-08-19; smoke item (e) FAILS). PAT must read stop count and stop times from the same record the inline panel renders from, keyed by work-opportunity id, instead of from the deleted sheet scrape. **Analysis is done — see BACKLOG 0h for the field table.** Coverage measured across 154 captured work opportunities: every field PAT needs is present at 100%. ⚠ Do NOT conflate with PLAN 8 (R-type / unsupported equipment) — that is a different modal, blocked on a captured manual upsert, and is not this regression. *Verify: open PAT on a card whose panel rendered; STOPS and both times prefill, and Confirm enables.*
   multi-leg board on screen. Check during Stage B before trusting it.
