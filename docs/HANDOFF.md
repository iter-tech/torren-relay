# HANDOFF.md — onboarding for a new project manager

**Written 2026-08-17.** Every fact below was read out of this repo today, not recalled. Where a
claim is unverified, it says so.

Read this file first, then `docs/PLAN.md` (sequence), then `STATE.md` (detail). `docs/CLAUDE.md`
is the rulebook and outranks this file if they ever disagree.

---

## 1. What Torren Relay is

A Chrome MV3 extension for **freight dispatchers** working Amazon Relay's load board. One
dispatcher watches loads for several drivers at once. The extension:

- **watches the board** and detects newly-appeared loads (`loadParser` → `loadDetector`)
- **alerts** — sound, tab flash, card highlight
- **auto-opens** the highest-paying new load
- **filters the board per origin city**, so a five-city search can be worked one driver at a time
- **renders its own inline panel** under a load: per-leg stops, times, distances, payout
- **Post-a-Truck (PAT)** — posts truck availability

**It never books.** Booking is Amazon's. The one exception is Fast Book, which clicks Amazon's own
Book button on explicit dispatcher action — see §2, closed topics.

### Working model

| role | who | does |
|---|---|---|
| **Project manager** | Claude Desktop | writes the prompts, decides sequencing, tracks the project. **Does not write production code.** |
| **Executor** | Claude Code | applies the prompts, writes the files, reports back |
| **Product owner** | **Ihor** | a dispatcher with years on this board. Product decisions are his. He is also **the only one who can verify anything live** — see §5. |

The executor has **no browser**. Nothing can be confirmed on a real board from inside the tooling.

---

## 2. The hard rules

### Verbatim from `docs/CLAUDE.md`

> **PROOF BEFORE REPORT.** Never report "done" for any UI-affecting change without actually
> exercising the changed flow (open the page/popup, perform the user scenario, observe the
> result). If a flow cannot be exercised from this environment, say so explicitly in the report
> and list exactly what the user must test manually — never imply it was verified.

> **SMOKE CHECKLIST** — after any UI-affecting change, run all six and report pass/fail per item:
>
> * (a) popup opens without console errors
> * (b) logged-out popup shows only the login block
> * (c) full login flow works (email → code → features appear)
> * (d) sidebar/panel activates on the load board
> * (e) PAT modal opens and Confirm enables with valid data
> * (f) no errors in the page console

> ## Code rules
>
> 1. NEVER use jQuery
> 2. NEVER use inline event handlers
> 3. Every UI element MUST have data-testid
> 4. Every function MUST have logger.log() at entry
> 5. Every catch MUST have logger.error() with context
> 6. NEVER use innerHTML with page data — use textContent

> ## Safety rules
>
> 1. Unsure about booking safety → ASK

### NEVER GUESS

Do not invent a field path, an enum value, a label, or a date format. **Read it out of
`samples/`.** If it is not in a capture, it is not known — say so and ask for a capture. This rule
exists because guesses have cost this project multiple rebuilds. Two concrete precedents:

- equipment labels are built **only** from enum values observed on disk; anything else renders an
  em dash (`docs/api-samples.md` §5.8)
- `loads[]` ordering was *assumed* to be segment order for a whole stage before anyone checked it;
  it was then verified four independent ways across all 71 multi-load records

### CLOSED TOPICS — do not re-audit, do not re-open

- **Fast Book.** Its behaviour is settled. It reads the card for the load id and Amazon's **live**
  sheet for the Book button; it does not depend on any scrape. Do not redesign it.
- **The empty `FORBIDDEN_SELECTORS`.** Settled. Do not re-audit.
- **The retained-but-disconnected rename-city code.** Settled.

Re-opening these has wasted whole sessions. If something looks wrong in them, ask Ihor rather than
investigating.

### Other standing constraints

- **Do not edit `content/nightMode.js`.** (This currently blocks one item — see §6.)
- Never select on `css-<hash>` class names. They change on every Amazon deploy and have broken
  this project three times.
- Colours come from existing `--ext-*` tokens only. No new hardcoded literals.
- Do not anchor on the text "Recently added" (not always rendered) or "Similar matches"
  (localised across 11 domains).
- If a test failure looks like a real product defect, **stop and report** — never "fix" the
  product to make a test pass.

---

## 3. Where we are now

**Pre-launch.** Not submitted to the Chrome Web Store.

**Shipped and live-verified:**
- board watching, new-load detection, alert, tab flash, highlight
- auto-open of the top new load, with the refresh loop stopping *before* it opens (PLAN 7b)
- **per-city filtering** — the core of this phase

**Built, awaiting Ihor's live test** (see §5): everything from 2026-08-13 onward, including the
auto-switch, the per-page working set, the merged coordinate map, and the entire inline-panel
rebuild.

### The inline panel rebuild — status, corrected

`docs/PLAN.md` §29 stages it. **A/B are done. C is NOT.**

| stage | status |
|---|---|
| A — remove the scrape path | **done** 2026-08-14 |
| B — render from the captured record | **done** 2026-08-14 |
| **C — wire into auto-open** | **NOT DONE — `blocked`** |
| D — measure detection→visible | blocked on C |
| E — derived segment duration | done, inside B |
| F — extra fields (cost items, layover, …) | next |

⚠ **Do not assume C is done.** `content/content.js` contains **zero** calls to
`showInlinePanel(` — verified today. Clicking a card manually shows the panel; **auto-open opens
the card but shows no panel of ours.** A test asserts this absence deliberately, so the suite is
green either way.

The panel now renders from captured API data with **no DOM scraping of any kind**. The old
click-then-scrape path (338 lines, every `.css-<hash>` selector, the 800 ms settle) is gone.

---

## 4. Settled architecture — do not re-litigate

Each of these was established the hard way. Re-deriving them costs days.

**1. Response bodies are captured by piggybacking Amazon's own `Response.prototype.json` read.**
`clone().text()` **cannot work**: the SPA aborts its own in-flight search after a 200, and
`AbortController.abort()` errors **both** tee branches regardless of buffering. The wrapper returns
the *original* promise object so identity is preserved. See `api-samples.md` §6.8.

**2. Captured endpoints — exactly three:**
`/api/loadboard/search`, `/api/loadboard/similar`, `/api/loadboard/recommendations/get`.
The last is **the source of the "Recently added" cards** — it was being seen and discarded for
weeks, which is why the newest loads were the ones showing as unassigned.
`WATCH_PATH` (rate-limit reporting) is **search-only and must stay that way** — widening it would
feed unrelated failures into the backoff.

**3. Ids from ALL buffered responses merge into ONE persistent `id -> {lat,lng}` map.**
Never pick one response. The old `pickBuffer()` chose the single highest-overlap response and
discarded the rest, which broke on pagination, on aborted requests, and across saved-search tabs.
Merging is safe because the work-opportunity id is globally unique — **measured: 13 ids appear in
more than one capture, 13 with identical coordinates, 0 conflicts.** The map persists across
cycles and is bounded at 4000, evicted oldest-first.

**4. The main results list:**
`getElementById('search-results-summary-panel')` → walk **following siblings** → first
`div.load-list`.
**The panel is a SIBLING of the results, never an ancestor.** A second `div.load-list` on the page
is the *Similar matches* block and must never be read.

**5. Card ids:** `div.load-card > div[id="<uuid>"]` — **bare UUIDs only.** Filter by UUID shape,
not by card class: a measured 9-result board found 8 by class and 9 by id, because the
recently-added card carries a different class. Cards also contain `div[id="STARTING_SOON"]`, which
the shape filter excludes.

**6. The "Showing" line carries TWO numbers.** `Showing 1 - 50 of 230 results` is a **rendered
range** *and* a **grand total**. They are equal only on a single-page board. Compare the collected
card count against the **RENDERED** count. Comparing against the total made every paginated board
skip its cycle and filtering appear dead.

**7. City membership = every active origin city within `CITY_ASSIGN_MAX_MILES` (150).**
**Not nearest-wins.** A load in range of two cities appears under both — that is how a dispatcher
decides which driver takes it. Per-city counts can therefore sum to more than the card count.

**8. We work only with the currently RENDERED page.** Ihor's rule. `Showing 1 - 50 of 145` means
we assign and filter those 50 and nothing else. A page change **replaces** the assignment map; an
ordinary re-render merges. Page changes are detected from the rendered range plus the first/last
card ids — **never from the pagination controls, which we never touch.**

**9. Unassigned loads stay VISIBLE and are counted on the "All" button.** Never hide what could
not be placed. The count is clickable and filters to just those loads. This exists because a
silently-broken assignment once looked exactly like a working filter — two city tabs showed
identical plausible lists and nothing on screen contradicted it.

**9a. REFINEMENT, 2026-08-20 (Ihor) — "visible" means visible IN "All", not under every city.**

⚠ **THIS REFINES RULE 9. IT DOES NOT CONTRADICT IT.** Read them together or you will undo one of
them. An unassigned load is still **visible** and still **counted** — in "All", where it now also
carries a marker reading *"Origin not determined"*. What it no longer does is appear under a
**city tab**.

**Ihor's reasoning, verbatim in substance:** a YORK, PA load was showing under the HEBRON, KY tab.
*If a dispatcher believes he is booking a load near Hebron and it is actually in New York, that is
a serious problem — not a cosmetic one.* Rule 9 protects against a filter that silently does
nothing; it was never a licence for a city tab to claim a load 450 miles away. A tab that does
that is lying to the dispatcher in a way that costs him money.

**Both categories of unassigned behave identically** — "never captured" and "captured but beyond
`CITY_ASSIGN_MAX_MILES` of every city". Before this, only the first was counted on the badge and
both were shown under every tab.

⚠ **Consequence, which follows necessarily and was not a separate decision:** `cityFilterHidesLoad()`
now returns true for an unassigned load, so a NEW unassigned load arriving while a city filter is
active is not auto-opened (correct — we only ever open something on screen) and not city-badged
(it has no city). The All badge count is the signal.

**If you are tempted to restore "never hidden":** you would be re-creating the YORK/HEBRON defect.
The half of rule 9 that must never be lost is *visible somewhere, and counted* — and All is where.

**10. Deadhead is replaced with our per-city distance ONLY on multi-city loads.** Amazon's
deadhead is one value for the whole search — the distance to the *nearest* of the selected cities.
On a load belonging to exactly one city it is already correct, so it is left alone.

**11. `CITY_FILTER_ENABLED` is a PRODUCT flag and must stay `true`.** It is not a debug switch. The
five debug flags ship **off**.

**12. One `/search` response = ONE page.** Never several. See §7 for the page-size correction.

**13. The dispatcher's RADIUS comes from the `/search` REQUEST body, per city.**
`originCitiesRadiusFilters[].radius` — a **bare number**, one entry per origin city, six fields
per entry. It replaced a hardcoded 150 that was measured wrong in **both** directions.
⚠ **Match entries to active cities by COORDINATES**, never by name (localised) or country
(**TULSA carried `country: null`** in the live capture). The two coordinate sources differ by
~4 mi, so the match bound is 15 mi; an ambiguous match is **refused**, not guessed.

**14. MIN_OPERATING_RADIUS = 25 — a FLOOR on membership, nothing else.**
Amazon **relaxes proximity below 25 mi** (measured: at radius 10 it returned loads at 13.64 and
16.15 mi) **and respects the boundary at or above it**. So membership uses
`Math.max(hisRadius, 25)`. ⚠ **It never touches the request, never rewrites the stored raw
radius, and never clamps the 150 fallback.** `effectiveRadiusFor()` is the **single definition**
used by both the assignment and every diagnostic, so a log line cannot print a limit the
membership test did not apply.

**15. Amazon returns TWO shapes of stop, in the same response.**
A **facility** (`"UNC3"`, `stopCode` set, coordinates set) and a **city-level** pickup
(`"LOCKBOURNE, OH"`, `stopCode`/`line1`/`postalCode` and **both coordinates** `null`).
Measured across 59 city-level stops: **zero counter-examples**, and `label` is exactly
`city + ", " + state` in 59/59. Assignment reads `stops[0]`, so a city-level FIRST stop is
what breaks it — **6 of 8 records** in the 2026-08-24 capture. They resolve through
`resolveCityCoords()` with state normalisation, at an accepted **3–10 mi** centroid error.

**16. Request-body capture sits BESIDE the response hook, never inside it.**
The `Response.prototype.json` piggyback (§6.8) is untouched. `init.body` is a plain string
already in hand — **no clone, no tee**, so none of the abort hazard that killed response cloning
applies. ⚠ **A non-string body STOPS and REPORTS. No Request is ever cloned.**

**17. A failure the dispatcher depends on must be VISIBLE, not merely logged.**
`reportDrop()` is gated on `CITY_ASSIGN_DEBUG`, which ships off — so "we could not read your
radius" would have been invisible in a real build. Those warnings ride a separate channel on the
PRODUCT flag and surface with `console.warn`, deduped once per session. **Silence there
re-creates the defect the warning exists to prevent.**

---

## 5. Verified live vs awaiting Ihor

**The executor has no browser. Nothing dated 2026-08-13 or later has been seen on a real board.**

### Verified live (Ihor confirmed)

| what | evidence |
|---|---|
| Main-list vs Similar-matches structure | live DOM capture, 2026-08-13 |
| `findMainResultsList` on the real board | live-verified under PLAN 3 |
| Per-cycle city assignment | `CITY DIAG 0/5` MATCH: YES every cycle; intersection **30/30 and 28/28**, zero unmatched |
| Body capture via `Response.json()` | board rendered normally with the wrapper installed |
| The recently-added card carries `wo-card-header--highlighted` | live 10-of-10 capture — this **disproved** a suspected silent alert-miss |
| **The six-item smoke checklist, all six** | Ihor, 2026-08-19/20 — ⚠ do not ask for another full run; ask for a named item and say why |
| **PAT modal opens, Confirm enables** | Ihor, 2026-08-20, on **both** a P and an R load |
| **Rate-limit auto-stop and the top-bar toast** | Ihor, 2026-08-20 — provoked deliberately: 2 tabs at 2.5s fine indefinitely, a 3rd → immediate 503 for 15+ min |
| **The `/search` REQUEST body carries a per-city radius** | Ihor, 2026-08-20 — capture saved to `samples/` |
| **City-level stops exist and break assignment** | Ihor, 2026-08-21/24 — 16 unassigned of 17; capture saved |
| **Amazon returns loads beyond a small radius** | Ihor, 2026-08-24 — at radius 10, JAX3 at 13.64 mi and DAL2 at 16.15 mi |

### Built but NOT verified live — the whole current phase

Auto-switch (7c) · merged coordinate map (7e) · per-page working set (7f) ·
`/recommendations/get` capture · inline panel Stages A and B · equipment labels · date format ·
the three panel visual fixes · the merged top bar and drag · the unmatched-loads counter.

**1345 automated checks pass across 20 suites.** That is not the same as working. A recent,
instructive failure: **1220 checks were green while clicking a card did nothing at all**, because
Stage A removed the render call and Stage B never restored it — and one of those green checks
asserted the missing call was missing. `wiring-suite` now exists precisely to dispatch a real click
and assert a panel appears.

**Ask Ihor to run the six-item smoke checklist before anything else.** It has been NOT RUN for
every change in this phase.

### 2026-08-20 — the smoke checklist is now COMPLETE, and what still needs a look

⚠ **The paragraph above is superseded: Ihor ran all six items in full on 2026-08-19/20 and all
six PASS.** Do not ask for another full run. Ask for a specific item, and say why.

**Confirmed live on a real board, 2026-08-20:** the cross-tab rate-limit auto-stop and the
top-bar message. Ihor provoked it deliberately — two tabs at 2.5s ran indefinitely, a third
produced an immediate 503 lasting over 15 minutes (see BACKLOG 0w for the derived limits).

**Awaiting Ihor — the five UI changes of 2026-08-20 (U1–U5).** Nothing below was exercised in
any browser; there is none in this environment. What to look at, per item:

| item | what to look at | the failure that matters |
|---|---|---|
| **U1** tab indicator | switch away, wait for a load, switch back | the **favicon** must return to Amazon's own, not merely stop moving. That was the defect |
| **U2** "All" button | sight along the top and bottom edges of the city row | any button shorter than the rest, badge or no badge |
| **U3** accordion rows | open a multi-stop load, look at the lower stop rows | a grey band where the panel surface shows through |
| **U4** Similar matches | start the loop on a board that has a Similar block | the block must be gone every time, with no toggle in the popup |
| **U5** rate-limit toast | `__EXT_DEBUG.simulateRateLimit(503, 3)` | after the toast fades, **play/pause must still read stopped** |

⚠ **U3 has a counterpart nobody may touch without asking.** The dark-mode zebra rule
`html.ext-night #ext-inline-panel tbody tr:nth-child(even) td{` at `content/nightMode.js:237`
produces the same banding in Night Mode. **`content/nightMode.js` is off limits by standing
constraint and was not edited.** Ihor must lift the constraint for that one line.

---

## 6. Open blockers — what each is waiting on

| # | item | blocked on |
|---|---|---|
| **10** | **Cross-tab rate limiting, live multi-tab test** | 🚫 **pre-launch blocker.** Needs Ihor with 4 tabs open: aggregate request rate must equal the global interval, not 4×; a forced 503 must pause and resume all tabs together. |
| **12** | Debug flags off, final build check | ⚠ **`DEBUG_LEVEL` is currently `3` in `utils/constants.js` and must return to `1` before shipping.** The other four flags are already off. |
| 6, 7 | Per-city filtering / button wiring marked done | **Only Ihor's eyes can close these.** Built and believed working; not confirmed. |
| 8 | PAT R-type (own-trailer) support | needs one **captured manual R upsert payload**. Cannot be guessed. |
| 11 | Full manual smoke pass + `TEST_CASES.md` | blocked on 6–8 |
| 13 | Store submission package | icons, privacy policy, listing copy, data disclosure, version bump, zip |
| 29c | Inline panel Stage C — wire auto-open | ready to start; nothing blocking but sequencing |
| 20 | Price-increase payout selector | needs a capture of a price-increased card |
| 21 | Non-US locale handling | needs a capture from a non-`.com` domain |
| 19 | Collapse Amazon's filters panel on START | no reliable read of open vs collapsed |
| — | **Night mode still zebra-stripes** the panel | `nightMode.js` holds a dark counterpart to a rule removed in light mode. **Blocked by the "do not edit nightMode.js" constraint** — one rule, removable the moment Ihor lifts it. |

---

## 7. Corrections to earlier documentation

Two claims that were in the docs and are **wrong**:

- ~~"`/search` paginates at page size 50"~~
- ~~"the live board now paginates at 5"~~

**Measured across every capture on disk today:**

| capture | records | `nextItemToken` | `totalResultsSize` |
|---|---|---|---|
| `paired-search` | 50 | 50 | 338 |
| `similar-1` | 50 | 50 | 232 |
| `search-5cities-active` | 50 | 50 | 104 |
| `search-5cities-other` | **5** | 5 | 11 |
| `search-2` | **4** | null | 4 |

**The page size is NOT fixed.** 4, 5 and 50 have all been observed. What is stable: a response
carries **at most 50** records, `nextItemToken` is a cursor equal to the records delivered so far,
and `totalResultsSize` is the grand total. **Never hardcode a page size — read the rendered range
from the Showing line.**

---

## 8. Where things live

| path | what |
|---|---|
| `content/networkObserver.js` | **MAIN world.** The only one. Wraps fetch/XHR + `Response.prototype`. Cannot see isolated-world globals (no `logger`) — it reports via `reportDrop()` and `postMessage`. |
| `content/cityAssign.js` | city assignment, the filter, the merged coord + record stores, deadhead substitution |
| `content/originCities.js` | the city buttons row, now inside the top bar |
| `content/inlinePanel.js` | the panel: record → render, Fast Book, PAT entry |
| `content/content.js` | the pipeline: detect → surge → highlight → alert → auto-open |
| `content/sidebar.js` | the top bar, and its drag behaviour |
| `samples/` | **the captures. ⚠ gitignored — they do not survive a clone.** |
| scratchpad `*-suite.mjs` | 20 Node suites, 1345 checks, run against the real source files |

**`samples/` being gitignored is a real risk:** every "measured from disk" fact in this repo
depends on files a fresh clone will not have. Ask Ihor for them before trusting any re-measurement.
