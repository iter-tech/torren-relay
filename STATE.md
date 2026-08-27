# STATE.md — where the project stands

**Last full sync: 2026-08-24.** Written to be read cold. If you are new here, read this file,
then `docs/HANDOFF.md`, then `docs/PLAN.md` — in that order, and nothing else is required.

---

## 🔴 THE ONE-LINE ANSWER: NOT SHIPPABLE TODAY

**Two hard blockers, neither of them polish:**

1. ⚠ **CORRECTED 2026-08-26 — PARTLY RESOLVED, NOT YET COMMITTED.** `DEBUG_LEVEL` and
   `CITY_ASSIGN_DEBUG` now read `1` and `false` in `utils/constants.js`, and the whole
   suite is green (**2433 / 0**). **But the change is UNCOMMITTED** — `git status` shows
   `M utils/constants.js`, so the committed history at b1b4c96 still builds a debug
   extension. **Commit it, then this blocker is closed.**
2. **`manifest.json` has NO `icons` key and NO `action.default_icon`.** The Chrome Web Store
   will not accept the package. It also requests `scripting`, which the codebase never uses.

Both are small edits. **Neither has been made, deliberately — this was an audit, not a fix.**
Everything else below is either done, deferred by decision, or waiting on Ihor's eyes.

---

## What this extension is, in four sentences

A Chrome MV3 extension ("Torren Relay") for Amazon Relay dispatchers. It watches the load board,
detects new loads, highlights them, plays a sound, marks the browser tab, opens the top load, and
shows an inline panel of the load's stops built from Amazon's own captured API response. It also
groups loads by origin city so a dispatcher running five cities can look at one at a time, and it
pre-fills Amazon's "Post a Truck" form from the captured record.

🔑 **IT NEVER BOOKS A LOAD.** Booking is entirely Amazon's. That is the product promise and the
safety boundary — see `docs/SAFETY.md`, which is canonical.

---

## ✅ SHIPPED AND TESTED since 2026-08-17 — verified against the repo, 2026-08-24

### Post-a-Truck, fully re-sourced from the captured API record

Every posted value now comes from **one load id plus one captured API record**. No DOM reads for
field values, with one declared exception (below). Verified field-by-field against **eleven real
Amazon upsert payloads** in `samples/`.

| value | rule | where |
|---|---|---|
| start time | first stop's CHECKIN **− 30 min** | `PAT_START_LEAD_MINUTES = 30` |
| end time | last stop's CHECKOUT **+ 3 h** | `PAT_END_TRAIL_HOURS = 3` |
| loading type | **always** `["LIVE"]` — Ihor's decision, every load, unconditionally | `PAT_LOADING_TYPE_LIST` |
| driver type | from `transitOperatorType` — a property of the LOAD, not a choice | `PAT_DRIVER_BY_TRANSIT_OPERATOR` |
| equipment | from the load's `equipmentType` enum | `PAT_EQUIPMENT_BY_ENUM` |
| stop count | from the record | `stopCount` |
| city / state | 50 states + DC + 13 CA provinces, **no fuzzy matching** | `PAT_STATE_CODE_BY_NAME` |
| payout | board payout **× 1.10**, dispatcher-editable — **unchanged** | `PAT_PAYOUT_MARKUP_RATE = 1.10` |

⚠ **ONE DECLARED DOM DEPENDENCY, authorised as interim:** trailer ownership (the P/R badge) is
read from the card's badge letter, because **the response body cannot answer it** — established
by scanning every field of 159 captured records. See BACKLOG 0p. ⚠ **"R" has never been observed
in a capture — only "P". The R branch is UNVERIFIED.**

### Clicking and opening

- **Click-zone guard.** A click whose `event.target` IS the card container is ignored — Amazon
  ignores those too, and acting on them showed one load's data under another load's highlight.
  ⚠ **The rule is TARGET IDENTITY, never geometry.** No pixel thresholds.
- **Recently-added cards resolve.** Those carry a different class and no `div.load-card` ancestor.
  The panel now finds the card by cityAssign's **UUID-shape** rule. ⚠ There were **THREE** copies
  of the class-based lookup — handler, load id, and the anchor check — and fixing two of them
  looked exactly like the fix not working.
- **Synthetic clicks carry coordinates.** `HTMLElement.click()` takes no arguments, so every
  auto-open click landed at (0,0), outside the target's own box; Amazon tolerated it 3 times in 5.
  It is now a constructed `MouseEvent` at the target's centre — still **one** click, same gates,
  no pointer/mouse-down sequence added.
- **A zero-box card defers.** A card not yet laid out is waited for, bounded at 10 frames, then
  given up on cleanly rather than clicked into the void. ⚠ `requestAnimationFrame` is suspended
  in a background tab, so the retry falls back to a timer there.

### The filter feedback loop is closed

The deadhead substitution is **idempotent**: a card already showing the right value is left
completely untouched — no `removeChild`, no `insertBefore`, no style write. Before this,
every filter apply produced 24 removes + 24 inserts, which are childList mutations the board
observer watches, which re-applied the filter. **Measured at ~27 wakes/sec.**

### Rate limiting — PLAN 10, closed by product decision

- **The shared cross-tab limit ships OFF** and its popup toggle is removed. Silently slowing
  refreshes reads as a broken extension, not as protection.
- **The loop auto-stops after THREE CONSECUTIVE** 429/502/503/504 responses. One isolated 502
  must not cost the dispatcher his board; the IP throttle lasts 10–15 minutes either way, so a
  late stop costs nothing and a false stop costs loads.
- ⚠ **Backoff and stop are deliberately decoupled** — backoff on the FIRST response, stop on the
  third. Do not re-couple them.
- A self-dismissing toast in the top bar explains it. ⚠ **The toast fading does not restart the
  loop** — play/pause is the standing indication of the stopped state.

📏 **MEASURED, not estimated:** two tabs at 2.5s ran indefinitely; a third produced an immediate
503 lasting over 15 minutes. Amazon tolerates ≈1 request/1.25s and refuses at ≈1/0.83s.

### Five UI changes (2026-08-20)

Tab indicator restores the page favicon and breathes one accent hue instead of strobing red;
city buttons share one height; accordion stop rows carry an explicit background; "Similar
matches" hides always and its toggle is gone; the rate-limit message is a self-dismissing toast.

### Rule 9a — unassigned loads are "All" only

🔑 **This REFINES rule 9, it does not overturn it.** Unassigned loads are still **visible and
counted** — in "All", where they carry an *"Origin not determined"* marker. They no longer appear
under a **city tab**, because a YORK, PA load under the HEBRON, KY tab tells the dispatcher an
origin the load does not have. See HANDOFF §4 rule 9a.

### The dispatcher's real radius, per city

The `/api/loadboard/search` **REQUEST body** is captured and carries
`originCitiesRadiusFilters[].radius` — one value **per city**, a bare number. Membership uses it,
matched to active origin cities **by coordinates** (name is localised; ⚠ **country is unreliable —
TULSA carried `country: null`** in the live capture).

This replaced a hardcoded 150 that was **measured wrong in both directions**: at radius 250 it
marked six legitimately-returned loads unassigned; at radius 50 it put a 122 mi load under HEBRON.

⚠ **Request capture sits BESIDE the response hook and does not touch it.** The
`Response.prototype.json` piggyback (api-samples §6.8) is unchanged. `init.body` is a plain
string already in hand — **no clone, no tee**, none of the abort hazard that killed response
cloning. A non-string body **stops and reports**; no Request is ever cloned.

### MIN_OPERATING_RADIUS = 25

📏 At radius **10 mi** Amazon still returned **JAX3 at 13.64 mi** and **DAL2 at 16.15 mi**.
Amazon **relaxes proximity below 25 mi and respects the boundary at or above it**, so membership
uses `Math.max(hisRadius, 25)`. A **floor**, not a tolerance and not a widening: at 50 mi
nothing changes.

⚠ **MEMBERSHIP ONLY.** It never touches the request, never rewrites the stored raw radius, and
never clamps the 150 fallback. `effectiveRadiusFor()` is the **single definition** used by both
the assignment and every diagnostic, so **a log line cannot print a limit the membership test did
not apply**. Lines read `25 (clamped from 10)` — the raw value is never hidden.

### City-level stops resolve

Amazon returns **two shapes of stop in one response**: a facility (`"UNC3"`, coordinates set)
and a **city-level** pickup (`"LOCKBOURNE, OH"`, `stopCode`/`line1`/`postalCode` and
**both coordinates null**). In Ihor's 2026-08-24 capture **six of eight records have a city-level
FIRST stop** — and `stops[0]` is the only stop assignment reads. Those now resolve through
`resolveCityCoords()`, with state normalisation. Ihor accepted the **3–10 mi centroid error**
(measured: median 3.3 mi, max 18.8 mi).

---
## 🔎 READINESS CHECK — audited 2026-08-24 against the repo, not from memory

### R1. Debug flags — committed value vs required shipping value

| flag | file | **committed** | must ship as | effect if shipped wrong |
|---|---|---|---|---|
| `DEBUG_LEVEL` | `utils/constants.js:42` | ⚠ **1 in the working tree, 3 in the last commit** | **1** | every `logger.log` prints — ~180 call sites |
| `CITY_ASSIGN_DEBUG` | `utils/constants.js:84` | ⚠ **false in the working tree, true in the last commit** | **false** | CITYDIAG, CLICKDIAG, AUTODIAG, WHY-UNASSIGNED all active |
| `CITY_ASSIGN_DEBUG` (MAIN mirror) | `content/networkObserver.js:51` | ✅ false | false | already correct |
| `CAPTURE_RESPONSES` | `utils/constants.js:62` | ✅ false | false | already correct |
| `CAPTURE_RESPONSES` (MAIN mirror) | `content/networkObserver.js:39` | ✅ false | false | already correct |
| `CITY_FILTER_ENABLED` | `utils/constants.js:108` | ✅ **true** | **true** | ⚠ PRODUCT flag — per-city filtering dies without it |
| `CITY_FILTER_ENABLED` (MAIN mirror) | `content/networkObserver.js:64` | ✅ true | true | already correct |

🔴 **THE TWO ISOLATED-WORLD FLAGS ARE COMMITTED WRONG.** This is not a working-tree slip — it is
in the history at **b1b4c96**, so a clean clone builds a debug extension. `capture-suite` has a
standing red for exactly this; **it is a true positive and must not be silenced.**

⚠ **The two halves of `CITY_ASSIGN_DEBUG` currently DISAGREE** — isolated `true`, MAIN `false`.
The constant's own comment says "flip both or the two halves disagree". Effect today: the raw
body, id samples and drop tracing stay off (good), while every isolated-world diagnostic is on.

🔴 **A DOCUMENTATION DEFECT THAT COULD CAUSE A WRONG FLIP.** `utils/constants.js:106` describes
`CITY_FILTER_ENABLED` as *"Shipped OFF"*. **That is stale and contradicts HANDOFF rule 11**,
which says it is a PRODUCT flag that must stay `true`. Anyone flipping flags from that comment
would disable per-city filtering. **Not corrected here — this was an audit.**

### R2. Diagnostic blocks added this phase

| block | gate | silent at stock level? | verdict |
|---|---|---|---|
| **CITYDIAG** (items 1–7, Q1–Q6) | `cityVerboseDiagnostics()` → `CITY_ASSIGN_DEBUG` | ✅ yes | **KEEP** — flag-gated, and item 6 is the divergence self-check |
| **CLICKDIAG** | `clickDiagEnabled()` → `CITY_ASSIGN_DEBUG` | ✅ yes — no listener is even registered | **KEEP** |
| **AUTODIAG** | `autoDiagEnabled()` → `CITY_ASSIGN_DEBUG` | ⚠ prints via `console.log`, so it IS visible at `DEBUG_LEVEL 1` **if the flag is on** | **KEEP** — silent once the flag ships `false` |
| **CITY WHY-UNASSIGNED** | `cityVerboseDiagnostics()` | ✅ yes | **KEEP** |
| **PATDIAG** (SOURCE, DRIVER) | `CITY_ASSIGN_DEBUG` | ✅ yes | **KEEP** — ⚠ the card values it prints are **never used**; if that ever became a fallback the whole re-source directive is lost |
| **CITY RAW 1–3** | `CITY_ASSIGN_DEBUG` **and** `CAPTURE_RESPONSES` | ✅ yes — double-gated | **KEEP** |
| **RATEDIAG** | ⚠ **NOT flag-gated** — deliberate | 🔴 **NO** — `console.log`, prints at stock level | ⚠ **REVIEW BEFORE SHIP.** It is user-triggered (`__EXT_DEBUG`) and its own comment says it bypasses `DEBUG_LEVEL` "so Ihor runs it without reconfiguring anything". It only prints when **called**, so a dispatcher never sees it — but it is the one block whose silence does not depend on a flag. |
| **CITY STOPS / CITY SEARCH REQUEST** | `logger.warn` + `console.warn` on failure only | ⚠ **intentionally visible** | **KEEP** — these are the "we could not read your radius" warnings. Silence here re-creates the defect they exist to prevent. |

### R3. Code left in place but unreachable — which are deliberate

| code | status | deliberate? |
|---|---|---|
| Shared-limit permit machinery (`permitQueueTail`, `GLOBAL_MIN_PERMIT_INTERVAL_MS`) | reachable but inert — `_sharedLimitEnabled = false` | ✅ **YES** — deferred, not deleted (BACKLOG 0s). Every tab still *sends* the permit request so 503 backoff keeps working, which is never optional. |
| `gateStillOpen()` in `content/content.js:323` | defined, **never called** | ⚠ **UNCONFIRMED.** Orphaned; no caller found. Harmless, but nobody has recorded a reason. |
| `HIDE_SIMILAR` storage listener in `content/filterSimilar.js` | present, returns without acting | ✅ **YES** — left inert so re-introducing the toggle is a one-line revert (U4). |
| Rename-city code (`startRenameCity()` etc.) | fully callable, **not wired to any click** | ✅ **YES** — a CLOSED TOPIC. Do not re-open, do not delete. |
| `CITY_ASSIGN_MAX_MILES = 150` | reachable only when a radius cannot be read | ✅ **YES** — kept as a **labelled, announced** last resort. Deleting it would force "assign to nothing" or "assign to everything". |
| `logUnmatchedProvenance()` | no longer called | ⚠ recorded in-file as dead weight; not removed. |

### R4. manifest.json vs Chrome Web Store

| item | value | verdict |
|---|---|---|
| `manifest_version` | 3 | ✅ |
| `name` | "Torren Relay" | ✅ matches `EXT_NAME` |
| `version` | `0.1.0` | ✅ valid; pre-1.0 is fine |
| `description` | "Monitors Amazon Relay Load Board for new loads. Does NOT book loads." | ✅ accurate and within 132 chars |
| `icons` | 🔴 **ABSENT** | **BLOCKER.** No `icons` key, no `action.default_icon`, and **no PNG anywhere in the repo**. CWS requires 128×128; Chrome shows a grey placeholder. |
| `permissions` | `storage`, `scripting`, `activeTab`, `clipboardWrite` | ⚠ see below |
| `host_permissions` | 11 Relay domains + `*.supabase.co` | ✅ justified — Supabase is the login backend |
| `background.service_worker` | `background.js` | ✅ |
| `web_accessible_resources` | absent | ✅ nothing needs it |

🔴 **`scripting` IS REQUESTED AND NEVER USED.** `chrome.scripting` appears **0 times** in the
codebase. CWS reviewers reject unused permissions, and it widens the install warning for no gain.

⚠ **`activeTab` appears nowhere as an API** — the only matches are the identifier
`activeTabsQueueTail`. It may still be needed implicitly; **verify before removing.**

⚠ **`clipboardWrite` — verify.** The code uses `navigator.clipboard.write()`, which in a
content script relies on a user gesture and focus rather than on this permission. It may be
removable; **this was not established.**

### R5. Open defects, by severity

| # | defect | severity | what closes it |
|---|---|---|---|
| 1 | `DEBUG_LEVEL` / `CITY_ASSIGN_DEBUG` committed wrong | 🔴 **BLOCKER** | two edits + a commit |
| 2 | No `icons` in the manifest, no PNG in the repo | 🔴 **BLOCKER** | draw/commit 16/32/48/128 px and declare them |
| 3 | `scripting` permission unused | 🟠 **HIGH** — CWS rejection risk | delete the line, re-test |
| 4 | P/R detection is a **DOM dependency**, and the **R branch is UNVERIFIED** | 🟠 **HIGH** | a labelled R capture (BACKLOG 0p) |
| 5 | Radius **unit is implicit** — a bare number, `.com`-only captures | 🟠 **HIGH on non-US** | a non-`.com` capture (BACKLOG 0ad, PLAN 21). On a metric board every range is ~38% short. |
| 6 | `normalizeState()` first-two-letters fallback (`"PENNSYLVANIA"` → `"PE"`) | 🟠 **MEDIUM** | ⚠ the **city-stop** path already refuses to truncate; the **PAT** path still does it (BACKLOG 0o) |
| 7 | `readMainCardElements()` has **no dedupe** | 🟡 LOW | duplicate ids yield duplicate entries; harmless today (BACKLOG 0b/0e) |
| 8 | `gateStillOpen()` orphaned | 🟡 LOW | delete or wire it, and record which |
| 9 | `utils/constants.js` calls `CITY_FILTER_ENABLED` "Shipped OFF" | 🟡 LOW but **dangerous** | one comment fix |
| 10 | Panel does not render on a 2208 px card | ⏸ **DEFERRED** | Ihor identified DevTools docked right as the cause — not a board condition (BACKLOG 0aa) |
| 11 | Accordion does not open in a background tab | ⏸ **DEFERRED** | Ihor re-tests first (BACKLOG 0x) |

### R6. Test suite health

- **2433 checks across 42 suites. 0 red. 0 crashed** (2026-08-26).
- ✅ The long-standing red — `capture-suite` → *"isolated CITY_ASSIGN_DEBUG ships false"* —
  **went green because the flag was FIXED, which is exactly how it was supposed to close.**
  ⚠ The fix is still uncommitted; see blocker 1.
- **No suite is knowingly asserting stale behaviour.** Every assertion that pinned a superseded
  rule this phase was updated with a dated comment explaining the change, not deleted.
- ⚠ **The runner now fails loudly on a CRASHED suite.** It previously keyed on a summary line, so
  three suites stopped running silently and two "all green" reports were over-counted. That is
  fixed, and it is why "0 crashed" is now stated explicitly.
- ⚠ **Tests passing is NOT verification.** 1220 checks were once green while clicking a card did
  nothing at all. See Part 4.

---
## 🚧 WHAT WOULD BLOCK A LAUNCH TODAY — ordered

**The extension is NOT shippable today.** Items 1–3 are packaging and configuration, not
features; they are small, but until they are done the package either does not build correctly or
does not pass review.

| # | blocker | what it is | what closing it requires |
|---|---|---|---|
| **1** | 🔴 Debug flags committed on | `DEBUG_LEVEL = 3`, `CITY_ASSIGN_DEBUG = true` at b1b4c96. A clean clone ships a debug build: verbose console on a dispatcher's machine, every diagnostic active. | Set to `1` / `false`, commit, confirm `capture-suite` goes green. **Do not silence the test instead.** |
| **2** | 🔴 No icons | No `icons` key, no `action.default_icon`, **no PNG anywhere in the repo**. CWS will not accept it; Chrome shows a grey placeholder. | Produce 16/32/48/128 px, commit them, declare both keys. |
| **3** | 🟠 Unused `scripting` permission | Requested in the manifest, `chrome.scripting` used **0 times**. Reviewers reject unused permissions and it widens the install warning. | Remove it; re-run the suite; **verify `activeTab` and `clipboardWrite` the same way** — neither was established as needed. |
| **4** | 🟠 P/R detection is a DOM dependency, R unverified | Trailer ownership is read from the card badge because the response body cannot answer it. **"R" has never been seen in a capture — only "P" — so the R branch has never executed.** A wrong P/R posts the wrong trailer type to Amazon. | A labelled R capture (BACKLOG 0p), then either a record-based rule or an explicit decision to ship the DOM read. |
| **5** | 🟠 Radius unit is implicit | `radius` is a bare number; every capture is `.com`. On a metric Relay domain every range is **~38% short** and loads vanish from their tabs. | A non-`.com` capture (BACKLOG 0ad / PLAN 21), or ship US-only and say so in the listing. |
| **6** | ⚠ Nothing is verified on a real board since 2026-08-20 | See below. This is not a code defect; it is the absence of evidence, and it has caught three shipped breakages here. | Ihor runs the checks in the next section. |

🔑 **If asked "can we ship this week?": not until 1–3 are done, and not responsibly until 6 is.**
Items 4 and 5 are shippable *with a stated limitation* (US-only, P/R may be wrong on R loads) if
Ihor accepts them — that is his call, not the executor's.

---

## 🧪 BUILT BUT NOT VERIFIED ON A REAL BOARD

⚠ **THE EXECUTOR HAS NO BROWSER. "Tests pass" and "Ihor saw it work" are different facts, and
this project has been bitten three times by treating them as the same one** — most memorably
**1220 green checks while clicking a card did nothing at all**, because one suite asserted that a
missing call was missing.

### ✅ Confirmed live by Ihor

| what | when | evidence |
|---|---|---|
| The six-item smoke checklist, all six | 2026-08-19/20 | ran in full |
| PAT modal opens and Confirm enables | 2026-08-20 | on **both** a P and an R load |
| Cross-tab rate limiting and the top-bar toast | 2026-08-20 | deliberately provoked; 2 tabs at 2.5s fine, a 3rd → immediate 503 for 15+ min |
| Per-cycle city assignment | earlier | intersection 30/30 and 28/28, zero unmatched |
| The `/search` REQUEST capture works | 2026-08-20 | he ran `__EXT_DEBUG.dumpSearchRequest()` and saved the output |
| City-level stops exist and break assignment | 2026-08-21 / 24 | 16 unassigned of 17; capture saved |
| At radius 10, Amazon returns 13.64 / 16.15 mi loads | 2026-08-24 | JAX3 and DAL2 |

### ⚠ NOT verified live — tests only

| what | risk if wrong |
|---|---|
| **MIN_OPERATING_RADIUS = 25** | ⚠ **Ihor reported the symptom; he has NOT confirmed the fix.** If the clamp misbehaves, loads land in the wrong city tab — the exact hazard rule 9a exists to prevent. |
| **City-level stop resolution** | Loads may still sit on All, or may be assigned to a neighbouring city. |
| **Per-city radius membership** (Part 2) | The acceptance criterion — an EMPTY All badge — has **never been observed**. |
| **The five UI changes** | All visual; the tab-favicon restore in particular was a real defect and its fix is unproven. |
| **Recently-added card resolution** | A recently-added load may still open Amazon's sheet and render no panel. |
| **Synthetic click coordinates / zero-box deferral** | Auto-open may still fail intermittently. |
| **The idempotent deadhead substitution** | If it regressed, the ~27 wakes/sec loop returns. |
| **Three-consecutive rate-limit stop** | Verified for the *message*; the **threshold** has not been provoked live. |
| **Rule 9a marking** | The *"Origin not determined"* badge has not been seen on a real card. |

### What Ihor should check first, in order

1. **Set Radius = 10.** The **All badge must read 0**, and the DAL2/JAX3 loads must sit inside the
   Dallas and Jacksonville tabs. The `CITY ASSIGN` line must read `=25 (clamped from 10)` —
   **if it reads `=10`, the clamp is not running.**
2. **Set Radius = 50.** The line must read `=50` with **no** clamp note, and a load beyond 50 mi
   must still be excluded. That proves the floor is not a blanket widening.
3. **Open a recently-added (highlighted) card.** Amazon highlights it **and** our panel renders.
4. **Switch away, wait for a new load, switch back.** The **favicon** must return to Amazon's own.
5. **Re-run smoke (d) and (f).**

---
## 🔴 SHIP GATE — a COMMITTED problem, not a local one

⚠ **`DEBUG_LEVEL = 3` and `CITY_ASSIGN_DEBUG = true` are COMMITTED to the repository** (b1b4c96,
`utils/constants.js`), not merely sitting in someone's working tree. **A clean clone builds a
debug extension.** Both must return to `1` / `false` before any build is produced.

This is why `capture-suite` has a standing red — it is a true positive and must stay red until
the flags are reset. **Do not silence it.**

⚠ The MAIN-world copy in `content/networkObserver.js` is a separate mirror
(`var CITY_ASSIGN_DEBUG = false;`) and is already correct. **Flipping only `utils/constants.js`
is the complete fix; flipping only the mirror is not.**

## ✅ MINIMUM OPERATING RADIUS — 25 mi floor, 2026-08-24

**Ihor's product rule, from a live measurement.** At radius **10 mi** Amazon still returned
**JAX3 at 13.64 mi** and **DAL2 at 16.15 mi**; judging them by his raw 10 stranded both on the
All tab. City membership now uses `effectiveRadius = Math.max(hisRadius, 25)`.

🔑 **A FLOOR, NOT A WIDENING.** Amazon relaxes proximity below 25 mi and respects the boundary
at or above it, so a 50 mi search is judged against 50 — nothing is loosened there.

⚠ **Membership only.** The search request, the captured radius and Amazon's payload are
untouched; `CITY_ASSIGN_MAX_MILES` is unchanged and is **not** clamped;
`computeAssignment()` stays synchronous. Every diagnostic prints `25 (clamped from 10)` so the
raw value is never hidden.

**To verify on the board:** set Radius = 10, and the **All badge should read 0** with the DAL2
and JAX3 loads inside the Dallas and Jacksonville tabs.

## ✅ CITY-LEVEL STOPS — FIXED 2026-08-24. Acceptance criterion awaiting Ihor's board run

**The cause was a stop SHAPE, not an endpoint and not the radius.** Amazon returns two shapes in
the same response; assignment reads `stops[0]`, and in Ihor's capture **six of eight records have
a city-level first stop**:

| shape | `label` | `stopCode` | coordinates |
|---|---|---|---|
| facility | `"UNC3"` | `"UNC3"` | ✅ set |
| **city-level** | `"LOCKBOURNE, OH"` | `null` | ❌ **null** |

**Fixed:** the city + state now cross to the isolated world and resolve through
`resolveCityCoords()`, with state normalisation. 🔑 **Ihor accepted the 3–10 mi centroid error**
(measured: median 3.3 mi, max 18.8 mi) — assigned to roughly the right city beats unassigned.
Provenance is tracked, so a centroid is never reported as a facility.

⚠ **THE ALL BADGE SHOULD NOW BE EMPTY, and it remains the self-check** — a count there still means
our radius or our positions have diverged from Amazon's, which is a bug and not noise.

**What to check on a real board:** the All badge is empty; the `CITY ASSIGN` line shows
`positions: N facility + M CITY CENTROID`; `CITY STOPS` reports one lookup per DISTINCT city and
**zero** new resolutions after the first cycle (the cache holding); and a full-state-name stop
(`"Illinois"`, `"Ohio"` both appear in the capture) resolves rather than reporting an
unrecognised state.

### Superseded diagnosis — kept for the record

**The cause is a stop SHAPE, not an endpoint and not the radius.** Amazon returns two shapes in
the same response:

| shape | `label` | `stopCode` | coordinates |
|---|---|---|---|
| facility (Amazon building) | `"UNC3"` | `"UNC3"` | ✅ populated |
| **city-level** (vendor pickup) | `"LOCKBOURNE, OH"` | `null` | ❌ **null** |

**Measured across all 159 captured records / 506 stops: 47 city-level stops, and a null latitude is
accompanied by null `stopCode`, `line1`, `postalCode` and `longitude` in 47 of 47 — no
counter-example.** `label` is exactly `city + ", " + state` on 47/47.

⚠ **Two earlier conclusions were WRONG and are corrected in BACKLOG 0af:** the `/similar`
attribution (the endpoint label is last-write-wins; the cards are in the MAIN list), and "the
failing shape has never been captured" (it is in our samples 47 times — the earlier scan only
looked at `stops[0]`, and every city-level stop we hold is a later stop).

🔑 **0 of 159 captured records have a city-level FIRST stop — and stop 0 is the only stop
assignment reads.** That is why this never surfaced, and why Ihor's board breaks.

**Part 2 still neither caused nor worsened this** — these loads fail before any distance is
computed.

**Nothing was changed by this diagnostic.** `resolveCityCoords()` could already take
`"LOCKBOURNE, OH"`; the open questions are the network cost, a strict `stateCode` match that
would reject full state names, and whether a city centroid is accurate enough at small radii
(**measured: median 3.3 mi, max 18.8 mi between facilities in one city**) — **Ihor's call.**

## Open diagnostics

- **PER-CITY RADIUS — BOTH PARTS LANDED 2026-08-20, awaiting Ihor's board run.** Membership now
  uses the radius **he** set, per city, read from his own `/search` request (field: `radius`, a
  bare number). Matched on **coordinates** — never name or country, because ⚠ **TULSA carried
  `country: null`** live. `CITY_ASSIGN_MAX_MILES` survives only as a **labelled last resort** that
  announces itself by city name.

  🔑 **THE "ALL" BADGE IS NOW A SELF-CHECK, AND THIS IS THE ACCEPTANCE CRITERION.** It must be
  **EMPTY**. Amazon only returns loads already inside his radius of a selected city, so once our
  membership uses that same radius every returned load belongs to at least one city and nothing
  can be unassigned. **⚠ A count on that badge is a BUG — our radius has diverged from Amazon's —
  NOT expected noise.** Treat it as a signal. The board's **total load count must not change at
  all**; only which tab each load appears under.

  🔴 **Still open: the radius UNIT is implicit** — a bare number on a `.com`-only capture set. On a
  metric domain every range would be ~38% short. No conversion is performed and non-`.com` boards
  are flagged; closing it needs a non-`.com` capture (BACKLOG 0ad, PLAN 21).

- **UNASSIGNED LOADS ARE "ALL" ONLY — fixed 2026-08-20, awaiting Ihor's board run.** A YORK, PA
  load was appearing under the HEBRON, KY tab. Both unassigned categories are now hidden from
  every city tab, shown under **All** with an *"Origin not determined"* marker, and **both**
  counted on the All badge (only one was before). 🔑 **Rule 9 is REFINED, not overturned** —
  HANDOFF §4 rule 9a. ⚠ `CITY_ASSIGN_MAX_MILES` untouched (PLAN 16 is Ihor's call). A new
  flag-gated `CITY WHY-UNASSIGNED` line says why each load was unplaced.


- **AUTO-OPEN — FIXED 2026-08-20, awaiting Ihor's board run.** Two measured failures, both fixed:
  a recently-added card has **no `div.load-card` ancestor** (resolved through cityAssign's
  id-shape rule now, in **three** places — handler, id, and anchor), and a **0x0 card** was being
  clicked before layout (bounded one-frame retry, then a clean give-up). The click also carries
  real coordinates now — `.click()` could not. 📏 **Tab visibility is NOT the cause and that
  hypothesis is closed.** ⚠ The 2026-08-19 container guard is deliberately unchanged.

- **AUTODIAG (2026-08-20)** — auto-open sometimes fails to open Amazon's sheet.
  `content/detailOpener.js` is instrumented behind `CITY_ASSIGN_DEBUG`; nothing is fixed.
  🔑 Already settled from source: **our click-zone guard cannot be the cause** — it calls neither
  `preventDefault` nor `stopPropagation`. ⚠ But a fallback in `detailOpener.js` dispatches at the
  **card container**, and Amazon was measured to ignore those. **Awaiting Ihor's board run**
  (TC-AUTODIAG): several foreground auto-opens and several background ones, then
  `__EXT_DEBUG.dumpAutoOpenDiag()`.

## Blockers

| blocker | waiting on |
|---|---|
| 🔴 **Smoke item (e) — PAT — re-test** (PLAN 30 / BACKLOG 0h, 0i) | **Ihor.** Record-sourcing, the modal crash and the silent-failure class are all fixed in code; 54 new end-to-end checks, 154/154 captured records open a modal. Nobody has seen it work. **Blocks launch until re-tested.** TC-PAT-MODAL-OPENS has the steps. |
| ⚠ **`["LIVE","DROP"]` never captured** (BACKLOG 0k) | **a capture from Ihor** of a manual PAT upsert with "Live or Drop & Hook" selected. Every posted value is verified except this array. |
| ⚠ **Two equipment enums have no mapping** (BACKLOG 0h item 1) | **a capture from Ihor** of a board carrying 40' Container or 26' Truck. Until then those loads route to the unsupported-equipment modal with the raw enum logged — deliberately, rather than guessing. |
| ✅ ~~Cross-tab rate limiting, live multi-tab test~~ (PLAN 10) | **CLOSED 2026-08-20 by product decision.** The shared limit ships OFF — the toggle is removed and slowing refreshes silently would read as broken, not as protection. **No aggregate-rate behaviour remains to test across tabs, so the four-tab run is retired.** Replaced by: the loop auto-stops on **three CONSECUTIVE** 429/502/503/504 responses in every tab and never auto-restarts, and a calm message appears in the top bar. ⚠ **Backoff still fires on the FIRST response — only the stop waits**, so an isolated 502 no longer costs the dispatcher his board. The counter is the existing `backoffStepIndex`; no second counter exists. Machinery deferred, not deleted (BACKLOG 0s). |
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

**1. ⚠ SUPERSEDED 2026-08-27 — Stage C is DE FACTO CLOSED. The claim below was wrong.**

The observation was accurate and the conclusion drawn from it was not. `content/content.js`
does contain **zero** `showInlinePanel(` calls — that is still true today. But auto-open never
needed one: its synthetic click bubbles to the same delegated handler a real click uses.

**The chain, from source:** `detailOpener.js:201-214` dispatches a
`new MouseEvent('click', { bubbles: true, … })` → it bubbles to the `document` listener at
`inlinePanel.js:1753` → `resolveCardForNode()` at `:1757` → `showInlinePanel(card)`
at `:1859`. **Nothing checks `event.isTrusted` anywhere in the codebase.** Ihor reports
live (2026-08-24) that the panel appears after auto-open every time.

⚠ **One branch still does not render, and it is unmeasured:** the fallback at
`detailOpener.js:161-166` dispatches at the CARD CONTAINER, which the guard at
`inlinePanel.js:1787` rejects by design. See PLAN 29c.

**THE ORIGINAL WARNING, kept because the lesson under it still stands:**

> *"Stage C is NOT done. `content/content.js` contains zero `showInlinePanel(` calls —
> verified 2026-08-17. Clicking a card shows the panel; auto-open opens the card but shows no
> panel of ours."*

🔑 **What to take from this: a true fact about one file is not a fact about the system.** The
grep was right; the architecture had moved. The same mistake in the opposite direction produced
item 2 below.

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
