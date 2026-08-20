# STATE.md — where the project stands

**Rewritten 2026-08-17.** Read `docs/HANDOFF.md` first if you are new. `docs/PLAN.md` holds the
ordered sequence; this file holds the state.

> ⚠ **This file lives at the repo ROOT, not in `docs/`.** Prompts sometimes say `docs/STATE.md`;
> there is only this one.

---

## Smoke checklist — RUN IN FULL BY IHOR, 2026-08-19

✅ **ALL SIX PASS — the checklist is COMPLETE for the first time this phase (2026-08-20).**
**Do not ask for a full re-run.** Ask for a re-test of a specific item only when a change
plausibly affects it — and say which one and why.

| | item | result |
|---|---|---|
| a | popup opens without console errors | ✅ PASS |
| b | logged-out popup shows only the login block | ✅ PASS |
| c | full login flow (email → code → features) | ✅ PASS |
| d | sidebar/panel activates on the load board | ✅ PASS |
| e | **PAT modal opens and Confirm enables** | ✅ **PASS** — Ihor, 2026-08-20, on both a P and an R load |
| f | no errors in the page console | ✅ PASS |

⚠ **(f) passing is itself evidence** for the PAT bug below: the failure throws an unhandled promise
rejection that never reaches `logger.error`, so the console stays clean while nothing happens.

---

## Current phase

**Pre-launch — and Post-a-Truck is BROKEN.**

🟠 **SMOKE CHECKLIST: 5 PASS, 1 FAIL — the fix is in, the re-test is not.** Item (e) — "PAT modal opens and Confirm enables with valid
data" — **FAILS**, confirmed live by Ihor on **2026-08-19**. The modal opens but Confirm never
enables: the STOPS field and both date/time fields come up empty, under
"Load times could not be read — enter start/end time manually" and
"Stop count could not be read — enter it manually".

**This was a REGRESSION we introduced in PLAN 29a (Stage A)** — PAT sourced those fields from
Amazon's detail sheet, and Stage A deleted the scrape. **FIXED IN CODE the same day** (PLAN 30):
PAT now builds every field from the captured record alone, per Ihor's architectural directive that
one work opportunity = one id + one block of API data, with no page DOM anywhere in the path.
154/154 captured records resolve with nothing missing.

**The crash and the silence are both FIXED (2026-08-19).** `equipment` is derived from the record;
`openPostModal` has a top-level try/catch logging message + stack + loadId; the dispatcher now
sees a failure dialog instead of a dead button; the caller handles the rejection. The posted
loading type is now the fixed **"Live or Drop & Hook"** for every load — **Ihor's product decision,
not a mapping**, so do not restore load-dependent behaviour.

**`patmodal-suite` now invokes `openPostModal()` end to end and asserts a modal node exists** —
154/154 captured records open one. That test is the direct answer to this being the third time a
green suite coexisted with a broken flow.

**City resolution fixed (2026-08-19).** Ihor's re-test got the modal open with the correct loading
type, and surfaced three more defects. The first — *"Could not resolve city: «MONROE, Ohio»"* with
Confirm disabled — is fixed: the record carries the state as **both** a two-letter code (454/506
stops) and a full name (52/506) in the same field, and `resolvePATCity` only matches codes. An
exhaustive US + Canada table now normalises it, with no fuzzy or first-two-letters fallback.

**Two defects remain (BACKLOG 0m, 0n):** a **Team** load posts as **Driver = Solo**, and an
**R (Required)** load posts as **Equipment = Provided**.

**0m is CLOSED (2026-08-19).** Ihor captured a real upsert containing `driverTypes: ["TEAM"]`, so
a team load now posts `["TEAM"]` with Confirm enabled. The same capture also corrected a value the
extension had wrong: `loadingTypeList` was `["LIVE","DROP"]`, **a shape that has never existed**
— in this API `["LIVE"]` IS the wider "Live or Drop & Hook" option. 26' Box Truck is now mapped.

**Every value PAT sends today is capture-backed.** The two remaining gaps are both *absence* of a
mapping, not a wrong value: `FORTY_FOOT_CONTAINER` is unmapped and refuses to post, and P/R is
not wired.

🔴 **0n / 0p (R posts as Provided) — SETTLED AS UNANSWERABLE FROM THE RESPONSE BODIES.**
Four hypotheses have now been refuted (`assetOwner`, `containerOwner`, C1, C5). The blocker is
structural, not effort: the request side is never captured, the response does not echo it, both P
and R variants serialise to the **same** `equipmentType`, and the labelled set inside the captures
is **1 P and 0 R** — so no field can be confirmed, only refuted. 83 fields vary and 63 survive the
single label; enumeration is exhausted.

**RESOLVED 2026-08-20 by (a), authorised by Ihor.** PAT now derives trailer ownership from the
card's P/R badge letter — **P → AMAZON_PROVIDED, R → CARRIER_OWNED**, anything else blocks Confirm.

🔴 **⚠ READ THIS BEFORE ASSUMING IT IS THE DESIGN: trailer ownership is the ONLY DOM-sourced field
in the PAT payload, and it deliberately breaks the "one id plus one API record" directive.** It is
a temporary exception, marked at the read site, and must be deleted when the record-based rule is
found or Ihor's backend supplies ownership directly. **It was not extended to any other field.**

⚠ **The R branch is UNVERIFIED** — "R" appears in no captured card. Confirm one R post on Amazon.

**Label collection is live**, so the record-based rule can finally be found: every parsed card's
badge letter is filed beside its record under the same id. Dump with
`__EXT_DEBUG.dumpTrailerLabels()` (works at the shipped `DEBUG_LEVEL`). **3 R labels make the
field enumeration conclusive; 5 gives margin.**

⚠ **Both debug flags are ON again** — `DEBUG_LEVEL = 3` and `CITY_ASSIGN_DEBUG = true`, turned on
for the RATEDIAG run. **Both must return to `1` and `false` before shipping**; `capture-suite`
fails on exactly this, by design. 1860 checks pass otherwise.

*(superseded note below)*
🔴 **Previously: `assetOwner` refuted, one hypothesis leading.** Two records with a **known P badge** carry different `assetOwner` values (`AZNG` and
`NCSL`), so it is ruled out in both directions — recorded so nobody re-derives it. The badge
itself is rendered as `div.trailer-type-circle > p`, a stable class that `loadParser.js` already
reads; that gave a second labelled record for free. Four hypotheses survive; **C1 — any stop with
`loadingType: "LIVE"` means R — leads**, because it is the only one with a mechanism and it
matches the upsert tie (`AMAZON_PROVIDED` → `["DROP"]`, `CARRIER_OWNED` → `["LIVE"]`). Half of
it is already confirmed: the paired card reads *Drop* and its badge is **P**.

**One question settles it:** on today's board, find any card whose Loading Type reads **Live** and
report the badge letter.

*(superseded note below)*
🔴 **Previously: blocked on DETECTION, candidate DISQUALIFIED.**
Eleven real upserts settled the payload enums, so the values are done. But measured across 159 work
opportunities / 506 stops, **no path in a search response carries `AMAZON_PROVIDED`/`CARRIER_OWNED`
or a bare P/R**, and `trailerDetails[].assetOwner` — the PLAN 29f candidate — is ruled out because
**42 of 159 loads carry two different owners across their own stops**. **Needed: the `/search`
response for an R-badge load and a P-badge load.**

🔴 **A decision is also waiting (BACKLOG 0q):** the captures tie `AMAZON_PROVIDED` to `["DROP"]`
(7/7) and `CARRIER_OWNED` to `["LIVE"]` (4/4), which conflicts with the standing "always Live or
Drop & Hook" rule. **PAT currently sends `AMAZON_PROVIDED` + `["LIVE"]`, a pairing that appears in
none of the eleven captures.**

✅ **53' Trailer is settled (2026-08-19).** The array was captured expanded, twice, and is
**byte-identical to the constant already in `patApi.js`** — five elements, same order — so no code
change was needed and it has been mapping correctly all along (BACKLOG 0r closed). Both order types
send the same array; only `providedTrailerType` differs, so equipment work and P/R detection stay
separable.

⚠ `FIFTY_THREE_FOOT_REEFER_TRUCK` is still unconfirmed and refuses to post.

🔴 **(e) still stands as FAIL until Ihor clicks it.** A fix nobody has seen work is not a pass.

The extension watches the board, alerts, auto-opens, filters per origin city, and renders its own
inline panel from captured API data. What remains before the Chrome Web Store is **verification
and packaging**, not features — with one genuine blocker (cross-tab rate limiting) and one
one-line ship gate (`DEBUG_LEVEL`).

---

## Done

### Live-verified by Ihor

- Board watching, new-load detection, sound alert, tab flash, card highlight
- **Auto-open stops the refresh loop BEFORE it opens** (PLAN 7b) — the accordion no longer
  vanishes after ~1s
- Main-list vs Similar-matches structure, and `findMainResultsList` against it
- **Per-cycle city assignment: intersection 30/30 and 28/28, zero unmatched**
- Body capture via the `Response.prototype.json` piggyback, with the board rendering normally
- The recently-added card carries `wo-card-header--highlighted` — this **disproved** a suspected
  silent alert-miss

### Built, tests green, NOT yet seen on a real board

Everything from 2026-08-13 onward:

- **Per-city filtering**, wired to the city buttons, single-select, "All" to reset
- **Auto-switch** — a new load in a non-active city pulls the view to it, unless the dispatcher is
  mid-work
- **Merged, persistent `id -> coords` map** — replaced `pickBuffer()`, which discarded every
  response but one
- **Per-page working set** — assignment and filtering follow the rendered page; a page change
  replaces the map
- **`/api/loadboard/recommendations/get` captured** — the source of the "Recently added" cards,
  previously seen and discarded
- **Inline panel Stages A + B** — the click-then-scrape path is gone (338 lines, every
  `.css-<hash>` selector, the 800 ms settle); the panel renders from the captured record, keyed by
  load id
- **Equipment labels and dated stop times** (`Mon Aug 17 17:30 EDT`, per-stop timezone)
- **Unmatched-loads counter** on the "All" button, clickable to inspect them
- **Merged top bar** — the city row is no longer a floating panel; the bar is draggable and
  re-docks on double-click; load-board only
- Three panel visual fixes: heading treatment (15.79:1), full-width table, no zebra striping

**1345 checks across 20 suites, 0 red.**

---

## In progress

Nothing is mid-edit. The tree is consistent; **1461 checks pass** and the single failure is a
deliberate true positive (`CITY_ASSIGN_DEBUG` is `true` in the working tree so Ihor can measure).

**Three live-found defects were diagnosed and fixed on 2026-08-19, all awaiting his confirmation:**

1. **The filter feedback loop.** Every filter apply removed and re-inserted our deadhead node;
   those childList mutations woke the board observer, which re-applied the filter — ~27 wakes/sec.
   Fixed by making the deadhead substitution **idempotent**. The observer was not touched.
2. **The click-zone mismatch.** A click on the card container's own padding opened our panel while
   Amazon left a different load highlighted. Fixed by ignoring clicks whose `event.target` IS the
   card container. The rule is **target identity, never geometry**.
3. **Out-of-range loads shown under every city tab** while the All badge reads zero — diagnosed,
   **not fixed**: the fix is a product decision (BACKLOG 0).

Two diagnostics remain in the tree behind `CITY_ASSIGN_DEBUG`: **CITYDIAG** (assignment, paging,
writes, observer wakes) and **CLICKDIAG** (click zone). Both are read-only and register nothing
when the flag is off.

---

## Next

1. **FIX POST-A-TRUCK (PLAN 30).** The one blocking regression. Analysis is complete in
   BACKLOG 0h; every field PAT needs is present in the captured projection at 100% coverage.
2. **Ihor confirms the two 2026-08-19 fixes on a real board** — TC-CITY-IDEMPOTENT and
   TC-CLICK-CONTAINER. These are the highest-value clicks he can make: both fixes were derived
   from live measurement but neither has been seen working.
2. **Ihor runs the six-item smoke checklist.** It has been NOT RUN for this entire phase.
2. **PLAN 29c — wire the inline panel into auto-open.** Ready; nothing blocking it.
3. **PLAN 10 — the cross-tab rate-limit multi-tab test.** The one real pre-launch blocker.
4. **PLAN 12 — return `DEBUG_LEVEL` to 1** and confirm a silent console at stock level.
5. **PLAN 13 — the store submission package.**

---

## Blockers

| blocker | waiting on |
|---|---|
| 🔴 **Smoke item (e) — PAT — re-test** (PLAN 30 / BACKLOG 0h, 0i) | **Ihor.** Record-sourcing, the modal crash and the silent-failure class are all fixed in code; 54 new end-to-end checks, 154/154 captured records open a modal. Nobody has seen it work. **Blocks launch until re-tested.** TC-PAT-MODAL-OPENS has the steps. |
| ⚠ **`["LIVE","DROP"]` never captured** (BACKLOG 0k) | **a capture from Ihor** of a manual PAT upsert with "Live or Drop & Hook" selected. Every posted value is verified except this array. |
| ⚠ **Two equipment enums have no mapping** (BACKLOG 0h item 1) | **a capture from Ihor** of a board carrying 40' Container or 26' Truck. Until then those loads route to the unsupported-equipment modal with the raw enum logged — deliberately, rather than guessing. |
| ✅ ~~Cross-tab rate limiting, live multi-tab test~~ (PLAN 10) | **CLOSED 2026-08-20 by product decision.** The shared limit ships OFF — the toggle is removed and slowing refreshes silently would read as broken, not as protection. **No aggregate-rate behaviour remains to test across tabs, so the four-tab run is retired.** Replaced by: the loop auto-stops on a real 429/502/503/504 in every tab and never auto-restarts, and a calm message appears in the top bar. Machinery deferred, not deleted (BACKLOG 0s). |
| ⚠ **`DEBUG_LEVEL` is `3`** in `utils/constants.js` | must be `1` before shipping. One line. The other four debug flags are already off; `CITY_FILTER_ENABLED` is a **product** flag and stays `true`. |
| PLAN 6 / 7 — filtering and button wiring | **Only Ihor's eyes can close these.** Built and believed working. |
| PLAN 8 — PAT R-type support | a **captured manual R upsert payload**. Cannot be guessed. |
| PLAN 20 — price-increase payout | a capture of a price-increased card |
| PLAN 21 — non-US locale | a capture from a non-`.com` domain |
| PLAN 19 — collapse Amazon's filters on START | no reliable read of open vs collapsed |
| **Night mode still zebra-stripes the panel** | `nightMode.js` keeps a dark counterpart to a rule removed in light mode. Blocked by the standing **"do not edit nightMode.js"** constraint — one rule, removable on Ihor's word. |
| PLAN 29c / 29d | sequencing only |
| ⚠ **`CITY_ASSIGN_DEBUG` is `true`** in `utils/constants.js` | left ON deliberately so Ihor can run CITYDIAG and CLICKDIAG. **Must return to `false` before shipping** — same one-line gate as `DEBUG_LEVEL`. `capture-suite` fails on exactly this, by design. |
| **Membership can exceed the Amazon search radius** (BACKLOG 0g) | **Ihor's product decision.** Measured: a 122.9 mi deadhead load shown under HEBRON, KY with radius 50, because `CITY_ASSIGN_MAX_MILES = 150` is independent of it. Related to PLAN 16. The constant was NOT changed. |
| **Out-of-range loads are shown under every tab and are absent from the All badge** (BACKLOG 0) | **Ihor's product decision** — four candidate fixes are written up; none was chosen unilaterally. |

---

## Two things a reader should not get wrong

**1. Stage C is NOT done.** `docs/PLAN.md` §29 lists A/B as done and **C as blocked**.
`content/content.js` contains **zero** `showInlinePanel(` calls — verified 2026-08-17. Clicking a
card shows the panel; **auto-open opens the card but shows no panel of ours.**

**2. Green tests are not verification.** The sharpest lesson of this phase: **1220 checks were
green while clicking a card produced nothing**, because Stage A removed the render call and Stage B
never restored it — and one of those green checks asserted the absence of that very call. Every
part was tested; nothing tested that the parts connect. `wiring-suite` now dispatches a real click
and asserts a panel appears.

---

## Risk worth repeating

**`samples/` is gitignored.** Every "measured from disk" fact in these docs — field enumerations,
the merge-safety proof, the page-size correction, the equipment labels — depends on files a fresh
clone will not have. Get them from Ihor before re-deriving anything.
