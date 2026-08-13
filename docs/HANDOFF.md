# HANDOFF — snapshot for an incoming project manager

**As of 2026-08-12.** Read this first, then `STATE.md`. No history here — only what you need to
act. Everything below was pulled from the repo, not from memory.

---

## 1. What the project is

**Torren Relay** is a Chrome MV3 extension in vanilla JS (no framework, no jQuery, no build step)
for **Amazon Relay carrier dispatchers**. It refreshes the load board, highlights new loads, plays
an alert, opens the top new load's detail panel, and helps create Post-a-Truck orders. **The
dispatcher books manually — the extension never books.** The working model is
**PM writes prompts / Claude Code executes**: you write the task specs and decide sequencing;
Claude Code writes the actual files. You do not write production code directly. The user
(**Ihor**) is the dispatcher and the only person who can run the extension in a real browser —
Claude Code has **no browser**, so every UI-affecting claim must be confirmed by him.

---

## 2. The hard rules — verbatim from `CLAUDE.md` and `api-samples.md`

> **Rule: never guess field names, enums, or formats — check here or capture a new sample.**
> — `api-samples.md`

> **PROOF BEFORE REPORT.** Never report "done" for any UI-affecting change without actually
> exercising the changed flow (open the page/popup, perform the user scenario, observe the
> result). If a flow cannot be exercised from this environment, say so explicitly in the report
> and list exactly what the user must test manually — never imply it was verified.

> **SMOKE CHECKLIST** — after any UI-affecting change, run all six and report pass/fail per item:
> - (a) popup opens without console errors
> - (b) logged-out popup shows only the login block
> - (c) full login flow works (email → code → features appear)
> - (d) sidebar/panel activates on the load board
> - (e) PAT modal opens and Confirm enables with valid data
> - (f) no errors in the page console

**Code rules (verbatim):** never jQuery; never inline event handlers; every UI element MUST have
a `data-testid`; every function MUST have `logger.log()` at entry; every catch MUST have
`logger.error()` with context; never `innerHTML` with page data — use `textContent`.
**Safety:** unsure about booking safety → **ASK**.

**Also standing:** never hardcode `css-<hash>` class names (they rotate on every Amazon deploy;
this repo has been bitten repeatedly). Colours come from `--ext-*` design tokens.

### CLOSED TOPICS — do not re-audit, do not "fix", do not flag
- **Fast Book behaviour** and the **empty `FORBIDDEN_SELECTORS`** — conscious product decisions.
- **The city→driver rename code** in `originCities.js` — intentionally retained though
  disconnected from the click. It is not dead code.
- Anything behind a flag that is off by default but wired correctly.

---

## 3. Where we are right now

**Feature in flight: Single-Tab Multi-Driver Monitor** (`PRODUCT.md`) — one Relay tab monitoring
several drivers in different regions, up to five origin cities, results split per driver. The
prerequisite being built now is **per-city load splitting**: deciding which origin city each
on-screen load belongs to.

**DONE and Ihor-verified on a live board:**
- **The id join.** A card's inner `div[id]`'s `.id` == `workOpportunities[].id`. Confirmed
  **20/20**. Recorded permanently in `api-samples.md` §6.6.
- **The 0/N root cause.** The board renders **two** `div.load-list` elements — main results and
  "Similar matches". The reader was taking the first one and collecting both: a "9 of 9 results"
  board yielded **13** cards. The 4 extras never appear in `/search`, so they could never join.
  Recorded in `AMAZON_SELECTORS.md`.
- **Both accumulator reset signals are wrong.** `searchAuditId` changes per **request**;
  `originCities` fires during the **normal staged load of the same search** (chips arrive one,
  then all five), which wiped 51 ids mid-fill.
- **There is no pagination to solve.** The main list renders all N at once ("10 of 10"). The
  earlier "paginates at 5" belief came from misreading the Similar-matches block.

**AWAITING Ihor's manual test:** the main-list scoping fix and the per-cycle rewrite — see §4.

**BLOCKED, and on exactly what:** moving `cityAssign` from log-only to **actually filtering
cards** is blocked on §4's test returning `MATCH: YES` with a non-zero intersection. Nothing may
consume the per-city counts until then.

**Other open blockers:**
- **🚫 PRE-LAUNCH BLOCKER — cross-tab rate limiting** is implemented but never verified in a real
  multi-tab browser session. Highest-priority open item before distributing to more than one
  dispatcher. See `BACKLOG.md` and `TEST_CASES.md` TC-RATELIMIT-1.
- **Five harness suites are RED — 43 assertions.** All 43 name functionality deleted in §4; core
  behaviour is green. `cityaccum-harness` tests deleted code end to end and should be retired.
  **Deliberately left red rather than edited.** Needs a decision before the next code change, or
  the next run's signal is unreadable.
- **`content/loadParser.js:124` is unaudited** and makes the same "first `div.load-list` is main"
  assumption that caused the 0/N bug. It feeds **highlighting and alerts** — things the
  dispatcher sees. Needs its own task.
- **⚠ The build is NOT shippable as it stands.** All five debug flags are **ON**:
  `DEBUG_LEVEL = 3`, `CAPTURE_RESPONSES` and `CITY_ASSIGN_DEBUG` `true` in **both** worlds
  (`utils/constants.js` and `content/networkObserver.js`). While `CITY_ASSIGN_DEBUG` is on the
  **raw response body is transported** across `postMessage`. All five must return to `1`/`false`.

---

## 4. The most recent unverified change

**`content/cityAssign.js` — per-cycle rewrite (2026-08-12). 1103 → 996 lines.**

The id accumulator, its 3000-entry cap, `mergeIntoAccumulator()`, `resetAccumulator()`, **both**
reset paths and every reset log line (`CITY DIAG RESET`, `CITY DIAG 5/5`) were removed. Each
cycle is now self-contained: current main-list card ids → the buffered `/search` response sharing
the most ids with the board → nearest active city by haversine → log. **No state crosses cycles.**

Unchanged: the join read, the main-list scoping, haversine, the 150 mi threshold, reading active
origin cities, and all `CITY_ASSIGN_DEBUG` gating.

### ⚠ `cityAssign` is still LOG-ONLY

It **does not hide, filter, reorder, restyle or badge a single card**. It mutates no DOM and
clicks nothing. Its entire output is console lines. Nothing the dispatcher sees is affected by
any of this work yet.

### What Ihor must do to confirm it

Flags are already on. **Reload the extension, then close and reopen the Relay tab** — content
scripts only inject at page load, so an open tab keeps running the old code.

Run a multi-city search and read the console (filter `EXT`):

1. **`CITY DIAG 0/5`** → must read **`MATCH: YES`**, i.e. collected card count **equals** the
   board's "of N results" number. This is the tell that Similar-matches cards are excluded.
2. **`CITY DIAG 3/4`** → intersection **non-zero on the FIRST cycle** (no scrolling needed).
3. **Zero `CITY DIAG RESET` lines** — the string no longer exists in the build.
4. Let auto-refresh tick several times → **no RESET spam, counts stay stable**.
5. Sanity-check `CITY ASSIGN` per-city counts against what he sees on the board.
6. **Then set all five flags back to `false`/`1`.**

Also confirm nothing user-facing moved: sidebar activates, START/STOP works, highlighting fires,
the origin-cities panel renders and follows.

**If `MATCH: NO — collected MORE`:** the panel token is matching something that still contains the
Similar block — capture the panel's class/id. **If `MATCH: unknown`:** the "Showing…" copy differs
from what the parser expects — capture the exact text.

---

## 5. The pending cleanup

A two-phase **audit-then-delete** task was run through **Phase 1 (inventory) only**. Findings:

- **Bucket C (orphans) was EMPTY** — zero unreferenced declarations across 404. The codebase is in
  better shape than a "clean up the cruft" brief assumes. **Do not commission a blind sweep.**
- **Already actioned** (they went with the §4 deletion): the write-only `_cityAccumAuditId`, a
  stale contradictory comment block, and the whole accumulator.
- **STILL PENDING, not yet approved:**
  - **Stale doc claims in `api-samples.md`** — §6.5 "page size 50" and §6.7 "paginates at 5" are
    both wrong; §6.7's two-tab fix-direction is moot. Docs only, but actively misleading.
  - **Debug-scaffolding consolidation (optional).** ~400 of `cityAssign.js`'s 996 lines are
    flag-gated `CITY DIAG` / `CITY RAW` diagnostics. They **stay** — proposal is only to move them
    to a `content/cityAssignDebug.js` so the live logic reads clean. Ergonomics, not cleanup.

---

## 6. File map — what each doc is for

| File | What it is for |
|---|---|
| **`STATE.md`** | The live status board: current phase / done / in progress / next / blockers. **Read after this file.** Rewritten at the end of every task. |
| **`BACKLOG.md`** | Planned features and engineering work, with a status key (UI-BUILT / PLANNED / PARTIAL). Holds the 🚫 PRE-LAUNCH BLOCKER section. |
| **`PRODUCT.md`** | Product-level record — what the extension is for and what differentiates it. Home of the Single-Tab Multi-Driver Monitor concept. |
| **`CLAUDE.md`** | The rules of engagement: working roles, token economy, code rules, safety rules, verification rules, and the end-of-task doc routine. **Binding.** |
| **`TEST_CASES.md`** | Manual test cases Ihor runs, with an "OUTSTANDING — run these first" section at the top. |
| **`UI_ELEMENTS.md`** | Registry of every UI element and its mandatory `data-testid`. |
| **`AMAZON_SELECTORS.md`** | Every selector we depend on in Amazon's DOM, with verification dates and known fragilities. **Check here before writing any selector.** |
| **`api-samples.md`** | Real captured API payloads and the field paths proven from them. Carries the never-guess rule and the confirmed id join (§6.6). |
| **`GLOSSARY.md`** | Short term definitions (Load, Layout A, and similar) for shared vocabulary. |

Also present: `SPEC.md` (MVP specification), `SAFETY.md` (booking-safety rules),
`CHANGELOG.md` (dated record of every change — append, never rewrite),
`BUG_REPORT_TEMPLATE.md`.
