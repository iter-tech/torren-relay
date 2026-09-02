# Feature Backlog

Status key: **UI-BUILT** = HTML/CSS exists in popup, logic not wired | **PLANNED** = not yet started | **PARTIAL** = some code exists

---

## ✅ SHIPPED 2026-08-13 → 2026-08-17 — the per-city phase and the inline-panel rebuild

Built, tests green, **none of it verified on a real board** (see `docs/HANDOFF.md` §5).

**Per-city filtering — the phase's headline.**
- City buttons filter the board; "All" resets. Hide/show is `style.display` only, never removal.
- **Range membership, not nearest-wins**: a load appears under EVERY active city within
  `CITY_ASSIGN_MAX_MILES` (150). Ihor's decision — two nearby cities should both see a load
  either driver could take.
- **Auto-switch**: a new load in a non-active city pulls the view to it — unless a panel is open
  or the loop is stopped, i.e. never while he is reading something.
- **Unassigned loads stay visible**, counted on the "All" button, and the count is **clickable**
  to inspect exactly which loads could not be placed and why.
- **Per-page working set**: assignment and filtering follow the rendered page. We never touch
  Amazon's pagination controls.
- **Per-city deadhead**: Amazon's deadhead is the distance to the *nearest* selected city, so on a
  load belonging to 2+ cities it is replaced with our own distance to the ACTIVE city. Single-city
  loads are left alone — Amazon's figure is already right for them.

**Capture layer.**
- Bodies captured by piggybacking Amazon's own `Response.prototype.json` read.
- **`/api/loadboard/recommendations/get` added** — the source of the "Recently added" cards. It
  was being seen and discarded, which is why the NEWEST loads were the ones showing unassigned.
- `pickBuffer()` replaced by a **merged, persistent id → coords map**.

**Inline panel — rebuilt from captured API data (PLAN §29 Stages A + B).**
- The click-then-scrape path is gone: 338 lines, every `.css-<hash>` selector, the 800 ms settle.
- The panel is **bound to a load id** and cannot exist without its card visible in the rendered
  main list — this killed the "panel opens under the wrong load" class of bug outright.
- Per-leg segments iterate `loads[]`; stop times render in **each stop's own timezone**.

**UI.**
- The city row moved **into the top bar** — it no longer floats over Amazon's filter controls and
  no longer appears on Trips. The bar is draggable and double-click re-docks it.
- Reserved badge slots so buttons never resize; only the ACTIVE button is highlighted.

---

## 🆕 EMERGED FROM THIS PHASE — not scheduled, not started

### 0av. ✅ CLOSED 2026-08-31 — THE PATHNAME IS NOW MEASURED, AND THE REAL CAUSE WAS A STALE CACHE

**✅ THE PATH IS CONFIRMED.** Ihor ran `__EXT_DEBUG.pageGate()` on the live board:

```
host     : relay.amazon.com
pathname : /loadboard/search
segments : ["","loadboard","search"]
```

**So `/loadboard/search` is MEASURED, not assumed, on `relay.amazon.com`** — the same string the
2026-08-27 sheet trace recorded. AMAZON_SELECTORS.md's table can treat `.com` as measured.
⚠ **The ten non-`.com` domains remain unmeasured — that is BACKLOG 0au, still open.**

**🔴 AND THE PATH WAS NEVER THE PROBLEM.** The same session showed `isLoadBoardPage(): true`
alongside `getAuthGate() -> { active:false, sessionActive:true, onLoadBoard:false }` — the check
and the gate disagreeing at the same instant. The cause was a **stale cached gate**: `getAuthGate()`
froze the composed session+page result at first call, and the first caller is `nightMode.js`
(script #12) against `content.js` (#31). Fixed by splitting the caches and by making the
navigation watch reconcile state instead of detecting edges. See CHANGELOG.

⚠ **Recorded so it is not relearned: an edge detector cannot detect an edge it started after**,
and **two correct halves tested separately are not a tested whole** — the suite drove
`isLoadBoardPage()` with a stub location and the gate with a stubbed `isLoadBoardPage`, and both
passed while the real pair was broken.

### 0av-was. The original entry (superseded)

**2026-08-31.** The page gate rejected `relay.amazon.com/loadboard/search` and nothing rendered.

🔑 **The comparison was NOT at fault.** `isLoadBoardPage()` was byte-verified correct for the
literal `/loadboard/search`, and the real `constants.js` + `authGate.js` driven together in one
shared global return `onLoadBoard: true` for it. **So the live `window.location.pathname` was not
that literal string** — a prefix is the ordinary reason, and the old first-segment rule rejected
every prefixed form.

**Fixed by accepting ANY path segment equal to `loadboard`**, which covers every prefix without
inventing one. ⚠ **But the actual pathname is still unknown**, and that is worth closing properly
rather than leaving to a rule that happens to be tolerant enough.

**WHAT CLOSES IT — one line, ten seconds:** on the load board, run

```
__EXT_DEBUG.pageGate()
```

and send the `pathname` line. That makes the real path MEASURED, and
docs/AMAZON_SELECTORS.md can stop calling it assumed.

⚠ **If it now activates and he never runs it, this stays open** — the rule is tolerant, not
informed, and the next path change would be another blind debugging session.

**Two lessons recorded so they are not relearned:**
- 🔴 **A silenced diagnostic costs more than a noisy one.** The warning was suppressed on `.com`
  because the path was "measured" there; that is exactly where it was needed. Silence removed.
- 🔴 **Two correct halves tested separately are not a tested whole.** `pagegate-suite` drove
  `isLoadBoardPage()` with a stub location and the gate composition with a **stubbed**
  `isLoadBoardPage`. Both passed; the pair had never been run together. A shared-global check now
  covers it.

### 0at. ✅ FIXED 2026-08-31 — THE TOP BAR APPEARED ON EVERY RELAY PAGE

**Reported live by Ihor with a screenshot 2026-08-31:** the Torren Relay top bar appeared on ANY
Relay page — Dashboard, Trips, anything — about half a second after the page opened, floating
mid-screen over Amazon's own UI on `/dashboard`.

**Cause: there was no page check at all.** Every module gated on `getAuthGate()` — "is he signed
in" — and nothing asked "is this the load board".

**Fixed by ONE definition, `isLoadBoardPage()` (`utils/constants.js`), composed into
`authGate.js`'s `_handleGateResult()`**, which is the single funnel every consumer already
subscribes to. Leaving the board now fires the same transition a logout does, so the existing,
already-tested teardown paths run. Plus an SPA navigation watch (poll + `popstate`) in
`content.js`, started **before** the gate's early return so an inactive tab can notice ARRIVING.

**Two things were found injecting off-board and are also fixed:** `highlighter.js` and
`priceSurge.js` both injected their `<style>` at **module load** on every Relay page.

New `pagegate-suite`, 46 checks, negative control run (5 fail without the fix). **2672 green.**

⚠ **NOT VERIFIED LIVE.** See the four navigation checks in CHANGELOG.

### 0au. 🔴 THE LOAD BOARD PATH IS UNVERIFIED ON TEN OF ELEVEN DOMAINS

**Separate from 0at, and still open.** `isLoadBoardPage()` recognises the board by its first path
segment, `loadboard`. That is **MEASURED on `relay.amazon.com` only** — every capture, sample and
measurement on disk is from `.com`; the other ten Relay domains appear exactly once each, in the
manifest's own host list, and in **no capture**.

⚠ **If the path differs on any of them, the extension will not activate there.** That would be
**worse than the bug just fixed**, because nothing on screen would say so.

🔑 **THE MITIGATION IS THAT IT IS NOT SILENT.** On a non-`.com` Relay page where we do not
activate, `warnIfUnrecognisedRelayPage()` emits a `console.warn` naming the host and the path,
saying the extension did not activate and that the path is measured on `.com` only. It also says
plainly that a Dashboard reading this is normal, so it does not cry wolf. ⚠ **`console.warn`, NOT
`logger.warn`** — the latter is silenced at the shipped `DEBUG_LEVEL` of 1, which is exactly how
`radiusUnitCaveat()`'s warning ended up invisible in a shipped build (BACKLOG 0ad).

**WHAT CLOSES THIS — one capture, and it is trivial:** open the load board on **any one**
non-`.com` Relay domain and read the address bar. If the first path segment is `loadboard`, the
assumption is confirmed for that domain and the table in AMAZON_SELECTORS.md becomes measured. If
it is not, the console warning will already be there naming the real path.

⚠ **Related but NOT the same as BACKLOG 0ad** (the radius unit on non-`.com`). Both are "we ship
to eleven domains and have measured one", and **one non-`.com` session would close both.**

### 0aq. ✅ CLOSED 2026-08-28 — THE PAT ORIGIN RADIUS DEFAULT OF 25 IS CORRECT

**Ihor's product decision. NOT a defect, NOT deferred, NOT a candidate for a later fix.**

⚠ **DO NOT "FIX" THIS.** It was reported as a symptom, traced to its line, and then closed as
intended behaviour. Anyone finding the hardcoded `25` again and reading it as a bug is repeating
work that is already done — read the reasoning before changing anything.

#### Why 25 is right

**A Post-a-Truck is created FOR a load already on the board that the dispatcher has decided to
take.** The post is anchored to **that load's own PICKUP location**, which our code fills in from
the record — **not** to the driver's home city. A 25-mile radius around a specific pickup point is
the right default, and the dropdown lets him change it when it is not.

🔑 The original symptom — *"I accept 45, our post says 25"* — was comparing the post's radius
against his **board search** radius. They are different things anchored to different points, and
they are not supposed to agree.

**Where the value comes from** (unchanged, and correct): `patModal.js:1169`, the third argument to
`makeSelect(testid, options, defaultVal)` → `patModal.js:1639` → `patApi.js:402`
`originCityRadius: { value: formState.originRadius, unit: 'mi' }`. Destination defaults to 50
(`:1199`).

#### ⚠ INVESTIGATED AND SETTLED — do not re-derive any of this

- **`MIN_OPERATING_RADIUS` (=25) does NOT reach the PAT payload.** All **8** occurrences are in
  `cityAssign.js`: the declaration (`:75`), the clamp inside `effectiveRadiusFor()` (`:97-98`),
  and five comment/log strings (`:68`, `:77`, `:1947`, `:1970`, `:3170`).
  `effectiveRadiusFor()`'s four callers — `:112`, `:1950`, `:2056`, `:3142` — are **membership or
  logging only**, all in the same file. Neither it nor `radiusLabelFor` appears anywhere else, and
  `patModal.js` / `patApi.js` reference neither. 🔑 **HANDOFF rule 14 HOLDS. The two 25s are a
  coincidence, and the PM hypothesis that the membership threshold had leaked into the request was
  DISPROVED.**
- **The dispatcher's per-city search radius IS available at PAT time and is deliberately NOT
  used.** `_citySearchRequest.radiusFilters` (`cityAssign.js:3512`, populated `:3521`) with the
  matcher `findRadiusForCity()` (`:2139`) is live in a shipped build — not debug-gated
  (`networkObserver.js:806`; listener registered outside the `CITY_ASSIGN_DEBUG` block at
  `cityAssign.js:3796-3797`). ⚠ **Wiring it into the post would be a REGRESSION, not an
  improvement**, for the reason above: the board search is anchored to his origin cities, the post
  is anchored to one load's pickup.
- **The origin dropdown offers 5 / 10 / 15 / 20 / 25 / 50 / 75 / 100. 45 is not selectable, and by
  the reasoning above that does not matter.** ⛔ **Do not add values. Do not convert it to free
  entry.**
- **A brief-premise correction worth keeping:** the four `samples/pat-upsert-*.json` files carry
  **NO radius field** — they are curated findings files about equipment / driver / loading-type
  enums, and their own `_provenance` says *"PARTIAL per capture … Anything not listed is UNKNOWN.
  Absence is not evidence."* **Radius ground truth lives in `samples/PAT Data}.txt` and
  `docs/api-samples.md`**: fields `originCityRadius` / `destinationCityRadius`, shape
  `{ value, unit: "mi" }`, observed values **25 / 50 / 100**. Our shape matches Amazon's.

### 0ar. 🔜 1.1 CANDIDATE — CHAT BUTTON ON THE LOAD CARD. **NOT STARTED, unscoped.**

Open Amazon's negotiation chat **bound to THAT load**. Today the chat opens on the **topmost
negotiable load**, so reaching the third one means opening and closing it three times.

Ihor reports competitors have this, **so it is feasible; HOW is unknown.**

🔴 **BLOCKED on a Network capture from Ihor.** Needed before any design:
1. Which requests fire when the chat button is pressed?
2. Does any of them carry a **work-opportunity id**?
3. Does the **URL** change?

⚠ **If no load id is passed, the feature is NOT POSSIBLE as described. Establish that first** —
before any UI, any button, or any estimate.

### 0as. 🔜 1.1 CANDIDATE — QUICK-PHRASE INSERTS FOR NEGOTIATION CHAT. **NOT STARTED, unscoped.**

10-15 canned dispatcher phrases inserted into the chat with one click instead of typing.

⚠ **Depends entirely on 0ar.** If the chat cannot be bound to a specific load, this has nothing to
insert into and does not begin.

### 0ap. 🔜 1.1 — MEMORY FLUSH WITH SESSION AUTO-RECOVERY (Ihor's spec, 2026-08-28)

**NOT STARTED, and BLOCKED on measurement — see the `memReport()` protocol below.**

⚠ **STILL BLOCKED as of 2026-08-28**, after the PAT keydown leak was fixed. That fix removes the
one listener that accumulated with ordinary use, but **it does not answer the question this item
is blocked on** — nobody has yet measured whether the heap actually grows over a shift. **The
four `heapUsedMB` readings are still owed.**

The proposal: flush memory by reloading the tab, then auto-restore the saved-search tab and the
refresh loop. ⚠ **The figure motivating it — "hundreds of MB to GB" — is an ASSUMPTION. Nothing
in this repository has ever measured it.** `__EXT_DEBUG.memReport()` was added on 2026-08-28
(measure-only, no product UI, no behaviour change) so the feature can be designed against real
numbers, or dropped if the growth is not there.

#### 🔑 THE PROTOCOL — until these readings exist, this item has no established problem to solve

With the refresh loop running as usual, in the ONE tab he actually works in:

| when | what |
|---|---|
| start of shift, right after login | `__EXT_DEBUG.memReport()` |
| after **1 hour** | `__EXT_DEBUG.memReport()` |
| after **3 hours** | `__EXT_DEBUG.memReport()` |
| end of shift | `__EXT_DEBUG.memReport()` |

🔑 **THE SINGLE NUMBER TO WATCH IS `heapUsedMB`.** Everything else in the report exists to say
*where* it went once that number has been shown to move. **If `heapUsedMB` is flat across the
four readings, this feature should be dropped, not designed** — a tab reload that interrupts a
dispatcher mid-shift to solve a problem that is not happening is a net loss.

⚠ `performance.memory` is Chrome-only, coarse and quantised. It is the only in-page number
available, so treat a change of a few MB as noise and look for a trend, not a delta.

#### What the source already says about the two recorded leaks

- **`ext-sidebar-styles`** — real, but ⚠ **it is NOT a shift-length leak.** `buildSidebar()`
  appends it (`sidebar.js:205`) and `deactivateExtensionUI()` never removes it, but
  `buildSidebar()` is reached **only** from `activateExtensionUI()` (`content.js:710`), which
  early-returns when already active. So one tag accumulates **per logout→login cycle**, not per
  refresh. On a normal shift `sidebarStyleTags` should read **1 all day**, costing ~11 KB once.
  **A correctness defect — a logged-out page keeps our CSS — not a memory problem.**
- **The coordinate map** — bounded at `CITY_PICKUP_MAX = 4000`, evicted oldest-first
  (`cityAssign.js:159`, `:348`), ~40 bytes per entry, so **~160 KB at its ceiling**. Five other
  per-id stores share that one eviction list, so they cannot outgrow it either. **Neither of the
  two recorded leaks can account for hundreds of MB.**

#### ⚠ Design risks recorded by the PM — read before building anything

- **Programmatically clicking Amazon's saved-search tab after reload is the same DOM-coupling
  class that killed task 7d.** That task read the card's own origin text, shipped, and left
  **every card unassigned** on the live board. A restore step that depends on finding and
  clicking an Amazon tab has the same failure shape, with a worse consequence: it fails **after**
  a reload has already destroyed the session state.
- **An automatic threshold-triggered reload could fire the moment a high-value load appears** —
  the exact instant the dispatcher must not lose the board.
- 🔑 **The PM's recommendation is MANUAL-ONLY, WITH CONFIRMATION.** No threshold, no timer, no
  automatic trigger.

#### Also found while measuring (2026-08-28) — recorded, NOT fixed

- ✅ **FIXED 2026-08-28 — `patModal.js`, the accumulating `keydown` listener on `document`.** It
  was the only listener in the extension that accumulated with ordinary use: `onKey` was removed
  only inside its own Escape branch, so the backdrop, Confirm, the ×, and **replacement by
  another modal** each left one behind for the life of the page, holding its modal's scope alive
  with it. `removePatModal()` now removes it, with the handle stored on the overlay element —
  the sidebar's `_extDragMove` pattern reused. Covers every close path **by construction**, since
  nothing outside `patModal.js` removes the overlay. New `patleak-suite`, 28 checks, all four
  close paths; **negative control run — 15 fail without the fix.** See CHANGELOG.
  ⚠ **Still open, deliberately out of scope:** the drag listeners at `patModal.js:1522-1523` are
  removed only on the next mouseup after close (`:1516-1519`) — lazy and self-healing, not
  permanent.
- 🟡 **STILL OPEN, NOT FIXED — `_cityNoCoordIds` (`cityAssign.js:270`) and `_cityCoordCache`
  (`:402`) are the only per-id stores NOT on the shared eviction list** — cleared on teardown only. `_cityNoCoordIds` grows
  with distinct coordinate-less ids seen (~60-100 bytes each); `_cityCoordCache` is bounded in
  practice by the number of distinct cities searched. Both are in `memReport()` marked
  `_UNBOUNDED`. **Watch them if the bounded stores sit at their cap and the heap still climbs.**
- ℹ️ **`ext-sidebar-styles` is the only injected `<style>` without a duplicate guard**, because it
  is the only one keyed by `data-testid` instead of `id`. Its five siblings all open with
  `if (document.getElementById(...)) return;`. **The fix pattern already exists five times over.**
- ℹ️ **No cycle counter and no activation timestamp exist anywhere** — not in `content.js`,
  `refreshManager.js`, `tabState` or storage. `memReport()` reports `cyclesCompleted` as
  **NOT TRACKED** rather than inferring it from uptime and the refresh interval.
- ℹ️ **Timeouts are not countable.** 21 `setTimeout` sites exist; **4** keep a handle. The three
  `setInterval` sites all keep one, so intervals are reported and timeouts are not.

### 0ao. 🔜 1.1 — RE-ENABLE FAST BOOK AFTER THE FIRST STORE REVIEW

**1.0 ships with `FAST_BOOK_ENABLED = false`** (`utils/constants.js`), so booking is unreachable
by three independent gates — see docs/SAFETY.md.

🔑 **FLIP THE CONSTANT AND UPDATE THE MANIFEST DESCRIPTION IN THE SAME CHANGE. The description's
truth depends on this flag.** Today the manifest says the extension *"does NOT book loads"*, and
that is only accurate because the constant is false. Flipping one without the other ships a false
statement to the store — which is the exact problem this gate was added to fix.

**What re-enabling involves:** one constant. ⚠ **Nothing was deleted** — the two-step click
sequence, the identity gate, the payout gate, the rehearsal helpers and `fastbook-suite` (110
checks, run with the flag forced true) are all intact and unmodified.

**Before flipping it, these are still open and are the reason it is not a one-line change:**

- 🔴 **The happy path has never been exercised live** (0al). The dry run returns before both
  clicks, so the two real clicks and the confirm poll have never run.
- 🔴 **`FORBIDDEN_SELECTORS` is an empty array** (`utils/constants.js:1-2`), so
  `isForbiddenElement()` always returns false — the "never books a load" guard is disarmed.
  ⚠ **Decide this deliberately before booking is reachable again.**
- 🟠 **The teardown asymmetry** (0al): `showInlinePanel()` replaces a panel with `old.remove()`,
  so a confirm poll survives a panel *replacement*.

**Ihor's call, after the first review comes back.**

### 0am. ✅ CLOSED 2026-08-27 — MANIFEST PERMISSIONS RESOLVED

Launch blocker **B3** ("`scripting` requested, used 0 times; verify `activeTab` and
`clipboardWrite` the same way") is **closed**. All three were settled from source rather than
guessed.

| permission | verdict | evidence |
|---|---|---|
| `scripting` | ❌ **REMOVED** | `grep -rn "chrome\.scripting"` — no match in any file |
| `activeTab` | ❌ **REMOVED** | The entire `chrome.*` surface is `storage.local`, `storage.onChanged`, `runtime.sendMessage`, `runtime.onMessage`, `tabs.onRemoved`. **No `executeScript` / `captureVisibleTab` / `insertCSS` / `tabs.query` / `tab.url`** — the APIs `activeTab` unlocks. `tabs.onRemoved` (`background.js:235`) needs no permission; page access comes from `host_permissions`. |
| `clipboardWrite` | ✅ **KEPT** | The write sits **two async hops** past its gesture — click (`inlinePanel.js:1449`) → `html2canvas().then()` (`:726`) → `toBlob(cb)` (`:735`) → `navigator.clipboard.write()` (`:738`). Source cannot establish that transient activation survives that, so the standing rule applies: **keep it**. |

⚠ **`activeTabsQueueTail` / `_activeTabCount` are NOT uses of `activeTab`** — recorded because a
future grep for the string finds them first and could reverse this decision on a misreading.

**Final: `"permissions": ["storage", "clipboardWrite"]`.**

🔴 **NOT YET PROVEN LIVE.** Two checks close it — see CHANGELOG and RELEASE_AUDIT.md: **(a)** the
popup opens with no console errors, and **(b)** the Copy Screenshot button still copies a card.

### 0an. 🟠 `utils/supabaseConfig.js` — PACKAGING DECISION FOR IHOR. Not fixed, not committed.

The file is gitignored (`.gitignore:8`) but loaded by `manifest.json:47`, so **a zip built from a
clean clone has no login and the extension does nothing.** It was NOT committed and its contents
were NOT printed — this entry records only what the consumers require.

**It must define exactly two globals**, by name, both read as bare globals (no `export`, no
`window.` prefix), from `utils/supabaseConfig.example.js` and both consumers:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

**How it fails when absent — the halves differ, and that matters:**

| consumer | behaviour | loudness |
|---|---|---|
| `popup/popup.js:41` | `typeof` guard leaves `supabaseClient = null`; a login attempt shows **"Login not configured."** (`:328`, `:359`) | 🟡 **Visible to the dispatcher** — but only if he tries to log in |
| `utils/authGate.js:15` | `typeof` guard leaves `_authGateClient = null`; `_checkAuthGateOnce()` logs `logger.warn('supabase client not configured — gate closed')` (`:22`) and returns `{ active: false }` | 🔴 **SILENT IN A SHIPPED BUILD** — `logger.warn` is suppressed at `DEBUG_LEVEL = 1` |

🔑 **So on the load board a missing config produces NO message anywhere.** Nothing throws — the
`typeof` guards see to that — the gate simply stays closed and the extension is inert. **A packaging
mistake here looks exactly like an extension that does not work**, which is the worst shape a
build error can take.

**Recommended packaging approach (Ihor decides):**

⚠ **The anon key ships readable either way** — anyone can unzip a published extension, so
"keeping it out of git" protects nothing once it is in the store. The decision is only about
**build reliability**, and on that ground:

1. 🔑 **Preferred — commit the real `utils/supabaseConfig.js` and drop it from `.gitignore`.** The
   anon key is designed to be public; **its safety comes entirely from row-level security on the
   Supabase side, not from secrecy.** This makes the repository the single source of truth and
   removes the whole class of "the zip is missing a file" failure. ⚠ **Only do this after
   confirming RLS is enforced** — that cannot be checked from this repository.
2. **Otherwise — add a build step that copies it in, plus a pre-zip check that the file exists
   and is not the example placeholder.** Keeps it out of git at the cost of a step that must never
   be forgotten, with no message if it is.
3. ⛔ **Do NOT rely on remembering.** The failure is silent on the board and only appears when a
   dispatcher tries to log in.

⚠ **If the key is ever treated as a secret, rotating it is not enough — it must move behind a
server the extension calls**, because the extension cannot hold a secret at all.


### 0al. 🟠 FAST BOOK — items 1-3 FIXED 2026-08-27, then the guard itself had to be fixed.

**🔴 THE GUARD WAS BLOCKING EVERY PRESS — FIXED 2026-08-27 (same day).** The identity check
shipped correct but read the open load's id from `#selected-work-sheet`, which **does not carry
it**. It returned `null` every time, and a fail-closed guard on a source that can never succeed
is a permanent outage. Fast Book refused every press with `openLoadId: '(missing)'`.

⛔ **DEAD HYPOTHESIS — the sheet has no load id. MEASURED, do not re-derive.** A full attribute
scan of the open sheet found **zero UUIDs** and no work/load/opportunity-named attribute. Its
only eight ids are `rlb-book-btn`, `rlb-book-trip-no-btn`,
`rlb-book-trip-confirm-booking-btn`, `alert-:r7j:`, `alert-:r7j:-children`, `expanded-header`,
`alert-:r7k:`, `alert-:r7k:-children`. The URL stays `/loadboard/search`.

**⚠ IDENTITY NOW DEPENDS ON AN AMAZON CLASS — `.load-card__selected`.** That is a real coupling
and it is accepted deliberately: it is the only measured source of the open load's id, and it is
semantic rather than a `css-<hash>` class. **The mitigation is that it fails LOUDLY** —
`logger.error` naming the marker, its own outcome `abort-no-marker`, and its own button state
saying reopening the load will not help. 🔑 **That loud-failure requirement is not optional and
must survive any future refactor of this path**: the whole reason this entry exists is that the
previous failure was silent and indistinguishable from the guard working correctly.

**A SECOND GATE was added: the payout.** The captured record's payout vs the amounts in the open
sheet. It **abstains rather than blocks** when it cannot check, and logs the abstain. See
docs/SAFETY.md.



⚠ **The Fast Book closed-topic constraint was lifted twice — once for the trace, once for the
fix — and is BACK IN FORCE.**

**✅ FIXED (`content/inlinePanel.js`, see CHANGELOG and docs/SAFETY.md):**

1. **The identity check.** `executeFastBook()` now compares the bound load id against the id
   actually open in the sheet, **strict equality, fail closed on either being missing**, with a
   visible blocked state on abort. One definition of the id-shape rule
   (`sheetOpenLoadId()`; `clickDiagSheetLoadId()` delegates).
2. **The confirm fallback is scoped to the sheet.** The exact-id lookup stays document-wide on
   purpose — the dialog may be portalled out, and an exact id cannot match another load.
3. **The poll is cancellable.** Module-level handle, cleared by `removeInlinePanel()`, which
   covers all four `enforcePanelAnchor()` sites (verified — it removes via
   `removeInlinePanel()`, never by touching the node).

**🔴 STILL OPEN — 1: THE TEARDOWN ASYMMETRY.** `showInlinePanel()` **replaces** a panel with
`old.remove()` directly (`inlinePanel.js:1165`) instead of calling
`removeInlinePanel()`, so it skips both the poll clear and the storage-listener removal. A
confirm poll therefore survives a panel being *replaced* by another load's. ⚠ Out of scope by
instruction and **deliberately not fixed**. Partly mitigated: `executeFastBook()` cancels any
live poll when it starts, so two polls cannot race.

**🔴 STILL OPEN — 2: THE AMAZON-SPA QUESTION, owed by Ihor.** From trace item 4: does Amazon
ever swap the CONTENT of `#selected-work-sheet` in place — same element, different load —
without our code touching it? **Not knowable from this repository.** To answer it: open a load,
leave the sheet open, let the board refresh, and watch whether the sheet's inner bare-UUID
`div[id]` changes while the sheet element persists. **This determines how often the new
identity check actually fires** — the guard is correct either way, but the frequency is unknown.

⚠ **The abort path cannot be produced on demand on a real board.** It is guarded by
`fastbook-suite` (85 checks), and since 2026-08-27 it can also be *watched* on a live board
with no booking possible, via `__EXT_DEBUG.fastBookForceMismatch()`. See TC-FASTBOOK-IDENTITY.

**🟡 STILL OPEN — 3: THE HAPPY PATH IS UNVERIFIED LIVE. Ihor's call.** Every claim about Fast
Book in this repository rests on `fastbook-suite` (85) and `fbrehearsal-suite` (41) driving the
real `executeFastBook()` against a **stub** sheet. **No Fast Book press has been performed on a
real board since the identity check landed.**

As of 2026-08-27 the console rehearsal (`__EXT_DEBUG.fastBookDryRun()`,
`__EXT_DEBUG.fastBookForceMismatch()`, see TC-FASTBOOK-IDENTITY) covers everything **up to** the
click: the sheet lookup, the Book-button lookup, the forbidden test, the identity comparison, the
abort, and the blocked button state. ⚠ **It deliberately stops there.** The two real clicks —
Amazon's Book button, then the confirm button — **and the whole confirm poll are never exercised
by the helpers**, because a dry run returns before the first one. **Only a genuine booking on a
real board covers those**, and that means spending money on a real load.

**Recommended order when Ihor chooses to do it:** run `fastBookDryRun()` first and confirm
`WOULD CLICK`; then `fastBookForceMismatch()` and confirm the abort is visible; only then a real
press, on a load he actually wants. **Not scheduled — this is Ihor's decision, not an assumption
to be made for him.**

### 0al-trace. THE ORIGINAL TRACE, 2026-08-27 — verdict was **NOT GUARANTEED**

⚠ **THE FAST BOOK CLOSED-TOPIC CONSTRAINT WAS LIFTED BY IHOR FOR THIS TRACE ONLY, AND IS BACK
IN FORCE.** Nothing was changed. No patch was written, none was proposed. This entry is the
record of what the source says; **what happens next is Ihor's decision, not the executor's.**

**The question asked:** can Fast Book click Book on a load OTHER than the one its button is
bound to?

#### 🔴 THE FINDING — THERE IS NO IDENTITY CHECK

`executeFastBook(sheetLoadId, fastBookBtn)` (`inlinePanel.js:359`) receives the bound
load id and **uses it for exactly one thing — a log line**:

```js
inlinePanel.js:360   logger.log('inlinePanel', 'executeFastBook called', { loadId: sheetLoadId, … });
```

**That is the ONLY reference to `sheetLoadId` anywhere in the function body** (lines 359-431,
verified by scan). It is never compared to anything. The function then does:

```js
inlinePanel.js:367   var sheet   = document.querySelector(SHEET_SELECTOR);   // '#selected-work-sheet'
inlinePanel.js:375   var bookBtn = sheet.querySelector('#rlb-book-btn');
inlinePanel.js:395   bookBtn.click();
```

🔑 **It clicks Book on WHATEVER LOAD IS CURRENTLY OPEN IN AMAZON'S SHEET.** It never reads the
sheet's own load id, so it cannot notice a mismatch. There is no abort path for one, because
there is no comparison to fail.

⚠ **The capability to read it already exists and is not used here:** `clickDiagSheetLoadId()`
(`inlinePanel.js:1492`) reads the first bare-UUID `div[id]` inside the sheet. It is wired
to CLICKDIAG only.

#### 1. BINDING — a CLOSURE, not an attribute or a lookup

```js
inlinePanel.js:1340   fastBookBtn.addEventListener('click', function () {
inlinePanel.js:1342     executeFastBook(sheetLoadId, fastBookBtn);
```

`sheetLoadId` is captured from `showInlinePanel`'s scope (`:1168`,
`var sheetLoadId = cardLoadIdFor(cardElement)`). The button carries **no** `data-` id
attribute and performs **no** lookup at click time.

**A stale button cannot survive a re-render, and that is what limits the exposure:**
`showInlinePanel` removes any existing panel before building the new one
(`:1164-1165`, `var old = document.getElementById(PANEL_ID); if (old) old.remove();`),
and `PANEL_ID` is a single id, so **only one panel and one Fast Book button exist at a time**.
A button bound to load A is destroyed when the panel for load B is built.

#### 2. THE SHEET SIDE

The sheet is located by a fixed id selector, `SHEET_SELECTOR = '#selected-work-sheet'`
(`inlinePanel.js:24`), read fresh at `:367`. **`sheetLoadId` is NOT read from the
sheet — the name is misleading.** It comes from the CARD (`:1168`, and the comment at
`:1167` says so: *"Reads the CARD, never a sheet"*).

#### 3. THE IDENTITY CHECK — **absent**. See the finding above.

#### 4. TIMING — partly unanswerable from source

The loop IS stopped before the panel opens, on both paths:
`inlinePanel.js:1835` (manual click) and `content.js:500` / `:531` (auto-open,
PLAN 7b). So during a normal Fast Book the refresh loop is not running.

⚠ **But that is a CONSEQUENCE of opening a panel, not a GUARD on booking.** Nothing in
`executeFastBook` checks whether the loop is running, and the dispatcher can press play at
any moment. On START, `content.js:657` calls `closePanelsForStart()`, which clicks
Amazon's own detail-sheet close button — **that path can close or change the sheet while a Fast
Book poll is in flight** (see item 7).

**`enforcePanelAnchor()` can remove OUR panel mid-flight** from four call sites —
`cityAssign.js:1806` (city filter changed), `:3209` (assignment cycle),
`:3311` (board re-render), `content.js:670` (loop stopped). ⚠ **Removing the panel does
NOT stop an in-flight poll** — see item 7.

🔴 **WHAT SOURCE CANNOT ANSWER:** whether Amazon ever swaps the CONTENT of `#selected-work-sheet`
in place — same element, different load — without our code touching it. That is Amazon's SPA
behaviour and is not knowable from this repository. **Ihor would have to observe it:** open a
load, leave the sheet open, let the board refresh, and watch whether the sheet's inner
bare-UUID `div[id]` changes while the sheet element itself persists.

#### 5. STALE DOM — bounded by the single-panel rule

One panel at a time (item 1), torn down at `:1165` and by `removeInlinePanel()`
(`:1371-1386`). ⚠ **One inconsistency, not a mis-booking risk:** `:1165` calls
`old.remove()` **directly** rather than `removeInlinePanel()`, so it skips the
`chrome.storage.onChanged.removeListener(_fastBookStorageListener)` at `:1385`. The
single-variable guard at `:1330-1331` limits it, but the paths are not symmetric.

#### 6. RECENTLY-ADDED CARDS — safe, and via the id-shape rule

Fast Book resolves **no card at all** — it works from the sheet. The id it is bound to comes
from `cardLoadIdFor(cardElement)` (`:1168`), which is the **UUID-shape** rule, not a
class-based lookup. ✅ **This is not a fourth instance of the class-lookup defect.**

#### 7. HOW MANY CLICKS — **TWO**, and the second one has a RETRY

```js
inlinePanel.js:395   bookBtn.click();       // one click, no pointer/mousedown sequence
inlinePanel.js:420   confirmBtn.click();    // a SECOND click, on the confirm dialog
```

⚠ **There IS a retry, and it is on the booking action.** `:401-429` polls every 100 ms for up
to 5 000 ms (`MAX_WAIT_MS = 5000`, `POLL_MS = 100`) looking for the confirm button, and
clicks the first thing it finds.

🔴 **The confirm fallback is DOCUMENT-WIDE, not scoped to the sheet:**

```js
inlinePanel.js:403   var confirmBtn = document.querySelector('#rlb-book-trip-confirm-booking-btn');
inlinePanel.js:406   var allBtns = document.querySelectorAll('button');   // WHOLE DOCUMENT
inlinePanel.js:409     if (t === 'Book' || t === 'Confirm' || t === 'Confirm booking') …
```

The only exclusion is `confirmBtn !== bookBtn` (`:412`). Any other button anywhere on the
page whose trimmed text is `Book`, `Confirm` or `Confirm booking` is a candidate for
five seconds. ⚠ **Nothing cancels this interval when the panel is removed** — `pollInterval` is
a local variable cleared only at `:413` and `:425`, and neither `removeInlinePanel()`
nor `enforcePanelAnchor()` can reach it.

#### VERDICT: (b) NOT GUARANTEED

**The precise branch:** `inlinePanel.js:395` — `bookBtn.click()` — is reached with **no
comparison whatsoever** between the button's bound `sheetLoadId` and the load actually open
in `#selected-work-sheet`. If the sheet's content differs from the panel's load at that
instant, **the wrong load is booked, and nothing in the code would notice or report it.**

**Likelihood from source alone — stated as the two separable parts:**

- The **single-panel rule** (`:1165`) and the **loop being stopped** (`:1835`,
  `content.js:500`) make a divergence *unlikely on the ordinary path*. Both are
  side-effects of other features, not guards on booking — **neither was designed to protect
  this, and either could change without anyone connecting it to Fast Book.**
- The **5-second document-wide confirm poll** (`:401-429`) is the widest exposure, and it
  is not bounded by either of those side-effects: it survives panel removal and searches the
  whole page.

⚠ **The frequency cannot be established from source.** It depends on whether Amazon re-uses the
sheet element for a different load — see item 4 for what Ihor would need to observe.

**No recommendation is made here, and no patch was written. Fast Book is closed again.**


### 0ak. 🔜 1.1 CANDIDATE — a distinct audio cue for a price increase

**Surge uses the same alert sound as a new load; a dispatcher cannot tell them apart by ear.
Distinct audio cue for a price increase. Not in 1.0.**

Both paths call the same `playAlert()` — the surge one at `content/priceSurge.js:146`.
A dispatcher hearing it has no way to know whether a **new load** arrived or an **existing**
one got more valuable, and those call for different reactions.

⚠ **NOT IN 1.0.** Recorded so it is not re-derived later, not so it is picked up now.


### 0aj. 🟠 FIXED 2026-08-27 — AWAITING IHOR. **Not closed.**

⚠ **The fix has NOT been seen working.** It is a scroll: the only way to know is to watch a few
auto-opens. Do not close this on the strength of the test suite.

**What was done:** `rescrollOpenedCard()` in `content/detailOpener.js` re-scrolls the card
one frame **after** the dispatch, by which point `showInlinePanel()` has already inserted the
panel synchronously and the page is its final height. Bounded: one frame, one attempt, clean
give-up if the card is gone or unlaid-out. Reuses `autoOpenNextFrame()`, so a hidden tab
falls back to a timer instead of hanging.

⚠ **The pre-click scroll was NOT removed** — it is load-bearing for a different reason
(`elementFromPoint` cannot hit an off-screen target). There are deliberately two.

**To close it:** Ihor lets several new loads auto-open in a row, foreground **and** background,
and confirms the opened card lands in view without the wheel.

### 0aj-was. 🟡 AUTO-OPEN DOES NOT SCROLL THE OPENED CARD INTO VIEW — reported live 2026-08-24

**Auto-open does not scroll the opened card into view. Reported live by Ihor 2026-08-24: the
load opens and the tab switches every time, but the page is sometimes not scrolled to the
newly-opened card and he must scroll manually. Cosmetic, not a launch blocker. Unstarted.**

⚠ **This is SEPARATE from PLAN 29c.** 29c is about whether the panel RENDERS; this is about
where the viewport is pointing afterwards. Do not merge them — the render is now traced as
working (29c), and this remains open.

Note for whoever picks it up: `detailOpener.js` already calls
`el.scrollIntoView({ block: 'center', inline: 'nearest' })` **before** the 250 ms settle,
i.e. before the panel is inserted. The panel is inserted as a sibling of the card afterwards,
which changes the page height. **Nothing re-scrolls after the insert.** That is a hypothesis
from source, not a diagnosis — it has not been measured.


### 0ah. 👁 SURGE INDICATOR HAS NEVER BEEN OBSERVED LIVE — simulation hook added 2026-08-26

**Surge indicator has never been observed live. Simulation hook added 2026-08-26; visual
confirmation still owed by Ihor.**

Payouts change too rarely on a real board to catch one, so the price-increase visual has shipped
through every review unseen. ⚠ **We must not ship a visual nobody has looked at.**

**The hook:** `__EXT_DEBUG.simulateSurge(loadId, newPayout)` in `content/priceSurge.js`,
with `__EXT_DEBUG.surgeCandidates()` to list ids and payouts off the current board.

🔑 **It does NOT call `highlightSurge()` directly.** That would prove only that the renderer
runs. It seeds `priceHistory[loadId]` — the one input the real comparison reads — so the next
ordinary tick fires detection, threshold, alert and auto-open through the whole real path.

⚠ **It clears itself after one tick** (`checkPriceSurge()` rebuilds `priceHistory` from
scratch every cycle), it never touches the `surgeEnabled` setting, and it adds no production
branch — it writes the same tabState key the normal flow already rewrites every tick.

**Still owed:** Ihor looking at the badge on a real card and saying whether it is right.
PLAN 20 stays **blocked** — the capture is still owed and this hook does not substitute for it.

### 0ai. 🔜 1.1 CANDIDATE — deadhead-adjusted RPM in the inline panel

**Deadhead-adjusted RPM in the inline panel. Data already in the projection: `payout.value`,
`deadhead.value`, `totalDistance.value`. Not in 1.0 — feature freeze.**

All three fields already cross the postMessage boundary in `projectRecord()`, so this needs no
new capture, no new endpoint and no new permission — only a rendering decision.

⚠ **NOT IN 1.0.** Recorded so it is not re-derived later, not so it is picked up now.


### 0ag. 🔑 SETTLED 2026-08-24 — CITY-LEVEL STOPS AND THE RADIUS CLAMP ARE TWO DIFFERENT BUGS

**Read this before 0af or 0ae. It resolves which story is true.**

It was suggested that the radius clamp **superseded** the city-level-stop investigation. ⚠ **It
does not, and the source settles it:**

```js
cityAssign.js:1916   if (!pickup) { unresolved++; ...; continue; }   // no coordinates -> out
cityAssign.js:1950   var eff = effectiveRadiusFor(resolved[m]);      // the clamp lives HERE
```

🔑 **A load with no coordinates returns at line 1916 and never reaches the radius test at all.**
No radius value — clamped, raw, or 150 — can rescue it. The clamp is arithmetic on a distance,
and there is no distance to compute.

| symptom | cause | fix |
|---|---|---|
| "NO COORDINATES", 16 of 17 unassigned (2026-08-21/24) | `stops[0]` is a **city-level** stop: `latitude`/`longitude` both `null`. **6 of 8 records** in the saved capture. | `resolvePendingCityStops()` — resolve the stop's own `city`/`state` through `resolveCityCoords()` |
| Loads at 13.64 / 16.15 mi unassigned at radius 10 (2026-08-24) | coordinates were **present**; the load was simply outside his configured radius | `MIN_OPERATING_RADIUS = 25` |

**So: does missing coordinates on city-level stops remain a real issue? NO — but not because of
the clamp.** It was closed by its own fix, which is in the code and is tested end-to-end against
Ihor's real capture (`citystop-suite`, 57 checks). ⚠ **Neither fix is verified on a live**
**board.** If city-level loads reappear on All, the clamp is the wrong place to look.

⚠ **Do not delete either fix on the belief that one supersedes the other.**

### 0af. ✅ CITY-LEVEL STOPS — FIXED 2026-08-24

**Loads whose pickup is a city rather than an Amazon facility now resolve.** The MAIN world carries
`{ id, city, state }` for a coordinate-less stop; the isolated world resolves it through
**`resolveCityCoords()`** — the same function that already resolves the dispatcher's origin
cities — after normalising the state via patApi's `STATE_NAME_TO_CODE`.

🔑 **Ihor's ruling, 2026-08-24: a 3–10 mi centroid error is ACCEPTABLE.** Getting loads onto city
tabs beats leaving them unassigned. Measured spread between facilities in one city: **median
3.3 mi, max 18.8 mi**. Provenance is tracked (`_cityPickupSourceById`) so a centroid is never
reported as a facility — the per-cycle line reads
`positions: 2 facility + 1 CITY CENTROID (±3-10 mi, accepted 2026-08-24)`.

⚠ **State normalisation is load-bearing, not a nicety.** `resolvePATCity()` matches
`stateCode` strictly, and **2 of the 12 city-level stops in the capture carry a full name**.
`normalizeStopState()` refuses an unrecognised name rather than truncating it to a guess
(`"PENNSYLVANIA"` → `"PE"`, BACKLOG 0o) — it returns null and the diagnostic says so.

**Cost:** one request per DISTINCT city, ever — `resolveCityCoords()` caches negatives too.

⚠ **`computeAssignment()` remains fully synchronous.** Resolution runs in the cycle before it; a
re-render frame with an unresolved stop leaves it unassigned and the next cycle picks it up.

### 0af-was. 🔴 CITY-LEVEL STOPS CARRY NO COORDINATES — the diagnosis (2026-08-24)

⚠ **THIS CORRECTS 0ae BELOW ON TWO POINTS. Read this one; 0ae is kept only as the record of a
wrong turn.**

**CORRECTION 1 — the endpoint is NOT the variable.** 0ae reported these loads as coming from
`/similar`. That label is `_cityIdEndpointById`, which is **last-write-wins**, as 0ae itself
flagged. Ihor confirms the cards are in the **MAIN results list**, not the Similar-matches block.
**Stop treating the endpoint as the cause.**

**CORRECTION 2 — 0ae concluded "the failing shape has never been captured". WRONG.** It IS in the
captures — 47 city-level stops across the samples on disk. 0ae only scanned `stops[0]`, and every
city-level stop we hold is a LATER stop, so the scan missed all 47. **The rule was already in our
own data.**

#### THE RULE — two shapes of stop, in the same response

| shape | `label` | `stopCode` | `line1` | `postalCode` | `latitude`/`longitude` |
|---|---|---|---|---|---|
| **facility** (Amazon building) | `"UNC3"` | `"UNC3"` | `"4525 STATESVILLE RD"` | `"28269"` | ✅ populated |
| **city-level** (vendor pickup) | `"LOCKBOURNE, OH"` | `null` | `null` | `null` | ❌ **null** |

**N1 — 47 city-level stops, ZERO counter-examples.** A null latitude is ALWAYS accompanied by
`stopCode`, `line1`, `postalCode` **and** `longitude` all null. The rule is exact.

**N2 — 47 of 506 stops (9.3%) are city-level.** ⚠ **But 0 of 159 records have a city-level FIRST
stop** — and stop 0 is the only stop assignment reads. That is why this never surfaced before, and
why Ihor's board breaks: **his loads have the city-level stop at position 0.**

**N3 — `city`, `state` and `timeZone` are populated on 47/47.** 🔑 **`label` is exactly
`city + ", " + state` on 47/47** — directly usable, no parsing invented.
⚠ Three state casings occur: `"OH"`, `"Ohio"`, `"KENTUCKY"`. Of the 47, **45 are 2-letter and 2
are full names**.

**N4 — the Required/Provided correlation CANNOT be confirmed from the data, and must not be
assumed.** We hold exactly **one** labelled P/R record (`pr-badge-labelled-records-2026-08-19.json`,
badge **P**), and it is a facility-to-facility LOADED load with coordinates on both stops —
consistent with Ihor's reading, but **n = 1 proves nothing**, and BACKLOG **0p** already
established the response body cannot distinguish P from R.

What the data DOES show: of 159 records, 13 carry a city-level stop, and **13/13 are
`loads[0].loadType === "EMPTY"`** (against 103 LOADED / 43 EMPTY among the rest). So EMPTY is
**necessary but not sufficient** in our captures. ⚠ **That is a correlation with the empty-leg
repositioning stops we happen to hold — NOT evidence about vendor pickups at stop 0.** Ihor's
mechanism (vendor pickups have no facility code, so no coordinates) is plausible and matches the
shape exactly; it is simply not yet measurable here.

#### N5 — options for resolving a city-level stop

🔑 **The function already exists: `resolveCityCoords(cityString)` in `content/cityAssign.js`** —
the same one that resolves the dispatcher's five origin cities.

| question | answer |
|---|---|
| Can it take `"LOCKBOURNE, OH"`? | ✅ **Yes, unchanged.** `parseCityState()` splits on the LAST comma and uppercases the state — exactly the `label` format, which is `city + ", " + state` on 47/47. |
| Does it need the network? | ⚠ **Yes.** It calls `resolvePATCity()` → `GET /api/loadboard/filters/cities/search/<city>`, which is **not memoised inside patApi** (up to three requests counting its retries). |
| Can results be cached? | ✅ **Already are.** `_cityCoordCache[cityString]`, in memory, per page session, **negative results cached too**. One request per distinct city, ever — a board with 11 distinct pickup cities costs 11 requests total, not 11 per refresh. |

⚠ **A GAP THAT WOULD BITE: `resolvePATCity()` matches `results[i].stateCode === state`, a strict
two-letter comparison, and does NOT call `normalizeState()` on a pre-parsed `{city, state}`
input.** A stop reading `"…, Pennsylvania"` would never match `stateCode: "PA"` and would resolve
to null. **2 of the 47 city-level stops on disk carry a full state name** (~4%). Related to
BACKLOG **0o** (`normalizeState`'s first-two-letters fallback: "PENNSYLVANIA" → "PE", wrong).

**Options, none implemented:**

| option | cost | failure mode |
|---|---|---|
| **A. Do nothing** | zero | City-level pickups stay All-only and marked. On a board dominated by them, per-city filtering is effectively unavailable. Honest and visible. |
| **B. Resolve `label` through `resolveCityCoords()`** | one network request per distinct city, cached forever; plus fixing the `stateCode` gap above | A city centroid is **not** the pickup facility — see the accuracy note. A city the endpoint cannot resolve returns null and the load stays unassigned, which is the current behaviour anyway. |
| **C. B, but only when stop 0 is city-level** | same, narrower | Same accuracy question, applied to fewer loads. Facility stops keep their exact coordinates. |

#### ⚠ THE ACCURACY QUESTION — IHOR'S CALL, NOT OURS

**A city centroid is not the pickup facility.** Measured over 27 cities in our captures that carry
more than one distinct facility: **median spread 3.3 mi between facilities in the same city,
maximum 18.8 mi** (JACKSONVILLE, FL — JAX9 vs JAX7). A centroid sits somewhere in that spread, so
the error is realistically **a few miles, up to about 10**.

- **At a 250-mile radius that is irrelevant** — nothing near a boundary.
- **At 50 miles it could place a load in the wrong city**, or drop one that belongs. A load
  measured at 47 mi might really be 55.

**This is Ihor's decision.** The trade is: a city-level load that is currently *unassigned and
marked* would become *assigned, possibly to a neighbouring city at a small radius*.

⛔ **NOT an option, and never to be proposed: reading city or address text off the CARD DOM.**
That is task **7d**, it failed live on 2026-08-13 leaving every card unassigned, and it must never
be reinvented. Everything above comes from the **captured API record**, a different source.

### 0ae. ⚠ SUPERSEDED BY 0af — PART 2 ACCEPTANCE CRITERION IS NOT MET (2026-08-21)

⚠ **TWO CONCLUSIONS HERE ARE WRONG — see 0af.** (1) The `/similar` attribution is misleading: the
endpoint label is last-write-wins and the cards are in the MAIN list. (2) "The failing shape has
never been captured" is false — it is in the samples, 47 times, but only ever at stops **after**
the first, which the scan did not reach. Kept as the record of the wrong turn.

### 0ae-was. PART 2 ACCEPTANCE CRITERION IS NOT MET — loads with NO COORDINATES (2026-08-21)

**Measured by Ihor, live, after Part 2 landed:**

```
CITY WHY-UNASSIGNED  16 unassigned of 17 rendered
radius per city: all five = 250
every one of the 16: NO COORDINATES — "listed in a captured response from [similar] but it
carried no latitude/longitude — _cityPickupById has no entry, _cityNoCoordIds does"
merged map holds 371 ids from 6 buffered responses
```

🔑 **THE ALL BADGE IS NOT EMPTY, SO THE SELF-CHECK IS DOING ITS JOB.** It is telling us about a
real gap. **The cause is NOT the radius and NOT the distance maths** — these loads fail before any
distance is computed, because there is no position to measure from.

#### S1 — what the samples on disk actually say

`samples/similar-1.json` (50 work opportunities) was measured field by field against
`samples/search-5cities-active.json`:

| check | result |
|---|---|
| `loads[0].stops[0].location.latitude` / `.longitude` present and numeric | ✅ **50 / 50** |
| absent, or present-but-null | **0** |
| `stops[0].stopType` | `PICKUP` **50/50** — the existing `stops[0]` rule holds |
| `workOpportunity` key set vs `/search` | **identical** |
| `loads[0]` key set | **identical** |
| `loads[0].stops[0]` key set | **identical** |
| `stops[0].location` key set | **identical** |
| `workOpportunities[].id` shape | bare UUID **50/50**, same as `/search` |

Across **every** sample on disk — 159 records, five files — the number of records where our
extractor would find no usable coordinates is **ZERO**.

⚠ **SO IT IS NEITHER A PARSING BUG NOR AN ENDPOINT LIMITATION, ON THE EVIDENCE WE HOLD.** For
every `/similar` record we have ever captured, the endpoint provides coordinates and our
extractor reads them correctly. **The shape that failed on Ihor's board is one we have never
captured.**

`/similar` also carries, on every record: `label`, `stopCode`, `line1`, `city`, `state`,
`country`, `postalCode`, `timeZone`, `domicile`. ⚠ `state` is a **mix of full names and
abbreviations in BOTH endpoints** (`/similar` 43 abbrev / 7 full; `/search` 49 / 1).

#### S2 — could another response supply the coordinates? The merge ALREADY tries

**Answer: no, and this is provable from the code rather than probable.** `mergePickupCoords()`
only ever ADDS; `_cityPickupById` persists across responses, is capped at `CITY_PICKUP_MAX = 4000`
(371 held, so nothing was evicted), and `computeAssignment()` checks it **before** anything else.

🔑 **So if ANY buffered response had carried coordinates for those 16 ids, they would already be
assigned.** The cross-response fallback S2 asks about is not a missing mechanism — it exists, it
ran, and the data was not there. **0 of the 16 appear with coordinates in any buffered response.**

The `[similar]` label is accurate but reports only the **last** endpoint that mentioned the id
(`_cityIdEndpointById` is last-write-wins). Since these ids never appeared in a `pairs` list, every
response that mentioned them listed them **without** coordinates.

#### S3 — Part 2 neither caused nor worsened this

**Stated plainly: PART 2 DID NOT CAUSE THIS AND DID NOT MAKE IT WORSE.**

- These loads fail at the **coordinate** stage. The radius is never consulted for them — there is
  no position to measure. Changing 150 → his real per-city radius cannot affect a load with no
  coordinates.
- They were **already** counted on the All badge before Part 2: the pre-2026-08-20 counter was
  `publishUnassignedCount(result.unresolved)`, and `unresolved` is exactly the no-coordinate
  category.
- What changed is **legibility, not behaviour**: rule 9a (2026-08-20) stopped showing them under
  every city tab and marked them; Part 2 then declared a non-empty badge to be a bug rather than
  noise. **The gap is pre-existing; the self-check is what made it impossible to ignore.**

#### S4 — options, none implemented

| option | cost | failure mode |
|---|---|---|
| **A. Do nothing** — accept that these loads are All-only and marked | zero | The dispatcher cannot filter them by city. On a Required-equipment board that is *most* of the list, so per-city filtering is effectively unavailable there. Honest, visible, and already what happens. |
| **B. Capture the failing response first, then decide** | one DevTools save | None. **Nothing can be designed until the failing shape is known** — every other option depends on what that body actually contains. |
| **C. Derive a position from other fields IN THE RESPONSE** (`postalCode`, or `city`+`state`) | a geocode lookup per distinct value, cached like `resolveCityCoords()` | ⚠ **Conditional on S1 for the failing board — unknown whether those fields are even populated there.** A ZIP centroid is not the warehouse: error of a few miles, which matters at a 50 mi radius and not at 250. Adds a network dependency to assignment. **Do not start without B.** |
| **D. Use Amazon's own `deadhead`** — one value per load, distance to the NEAREST selected city | none; already captured and already in memory | Cannot say WHICH city, so it cannot produce membership. It could only prove a load is inside *someone's* radius. Also unknown whether `/similar` populates it on the failing board. |

⛔ **NOT AN OPTION: parsing addresses, ZIPs, city names or facility codes off the CARD.** That is
task **7d**. It **FAILED LIVE on 2026-08-13**, leaving every card unassigned, and is recorded as
never to be reinvented. Options C and D read the **captured response**, never the DOM.

#### What Ihor must capture to settle it

1. Put the board in the state that fails — **Required equipment**, the one where 16 of 17 went
   unassigned.
2. DevTools → **Network** → filter `similar` → click the `/api/loadboard/similar` request →
   **Response** tab → save the whole body as `samples/similar-required-2026-08-21.json`.
3. If the failing cards are served by a different endpoint, save that body instead — the
   `CITY ENDPOINT SHAPE` line names every endpoint seen and its record count.
4. Also paste the `CITY WHY-UNASSIGNED` block and **one** of the 16 load ids, so the id can be
   found in the saved body.

⚠ **Do not guess from the existing `similar-1.json`** — it is from a 53' board and shows the
problem NOT happening. The capture that matters is the one that fails.


### 0ad. 🔴 THE RADIUS UNIT IS IMPLICIT — needs a non-.com capture (2026-08-20)

`radius` is a **bare number**. Every other distance in this API carries a unit — `deadhead`,
`totalDistance` and per-load `distance` all say `"miles"`; the PAT upsert says `"mi"`. **This one
says nothing.**

Every capture on disk is from a **`.com`** board and our maths is miles. On a metric Relay domain
(de, fr, it, es, pl, cz, in, co.jp) the number would mean **kilometres** and every range would be
**~38% short** — loads would silently vanish from their city tabs.

**What is in place:** `radiusUnitCaveat()` marks every diagnostic line that quotes a radius when
the host is not `relay.amazon.com`; **no conversion is ever performed**; an **unknown** host says
nothing rather than the wrong thing.

**What is needed to close it: a non-`.com` capture** — the same artefact **PLAN 21 (non-US
locale)** already requires. ⚠ Do not guess the unit from the domain; capture it.

### 0ac. ✅ PER-CITY RADIUS — BOTH PARTS LANDED 2026-08-20

**Ihor captured the `/api/loadboard/search` REQUEST body. The radius is in it — and it is**
**PER CITY**, in `originCitiesRadiusFilters[]`, one entry per origin city.

⚠ **CORRECTION TO A WORKING ASSUMPTION.** We had "one radius for the whole search". The API
stores one **per city**. The UI may set them alike; do not build on that.

**PART 1 — DONE.** The `window.fetch` wrapper (which already read `init.signal`) now also reads
`init.body` for `WATCH_PATH` only. 🔑 **The response machinery is untouched** — no clone, no tee,
none of §6.8's abort hazard, because that hazard belongs to response *streams*. A non-string body
**stops and reports**; no `Request` is ever cloned.

✅ **PART 2 — DONE.** The field is **`radius`**, a **bare number**, one per city. Membership uses
each city's own value, matched to our active origin cities by **haversine distance** — never by
name (localised) or country (⚠ **TULSA carried `country: null`** in the live capture).

⚠ **The two coordinate sources differ by ~4 mi** (request entry vs cities endpoint), so the match
bound is **15 miles** — well above that gap, well below the distance between distinct selected
cities. An **ambiguous** match is **refused**, never guessed.

🔑 **THE ALL BADGE IS NOW A SELF-CHECK.** It must be EMPTY: Amazon only returns loads inside his
radius, so every returned load belongs to a city. **A count on it is a BUG, not noise.**

**`CITY_ASSIGN_MAX_MILES` is KEPT as a labelled last resort**, not deleted — an unreadable radius
would otherwise have to mean "assign to nothing" or "assign to everything". It announces itself:
`console.warn` by city name, `(FALLBACK)` on every line, and an explicit "not the dispatcher's
setting".

⚠ **When Part 2 lands, "fall back to 150" is not acceptable.** A visible channel already exists
for this (`reportRequestIssue` → `console.warn`), deliberately NOT on the debug flag, because
`reportDrop` ships off and would have made the failure invisible.

✅ **Clau2de's separate finding resolves itself here, with no second mechanism:** a load should
not be called *"Origin not determined"* merely for exceeding 150 mi, because Amazon returned it
and its origin IS known. Once membership uses the dispatcher's real per-city radius, a returned
load is inside that radius of at least one selected city by construction, so the out-of-range
category empties out on its own. **Nothing extra should be added for it.**


### 0ab. 🔬 CAN WE READ THE DISPATCHER'S SEARCH RADIUS? — measured 2026-08-20, NOTHING CHANGED

**Ihor is right that `CITY_ASSIGN_MAX_MILES = 150` is wrong in both directions**, and he has
measured both:

| his radius | our limit | result |
|---|---|---|
| **250** | 150 | six loads with deadhead **151–222 mi** marked *"Origin not determined"* — Amazon returned them legitimately, and we declared their origin unknown |
| **50** | 150 | a load **122 mi** from HEBRON appeared under the HEBRON tab (measured 2026-08-19) |

The radius is **one value for the whole search**, not per city. ⚠ **Do not turn it into a
per-city setting.**

#### R1 — the DOM: the field is not merely fragile, it is probably ABSENT while we run

⚠ **NO capture of a load-board radius control exists anywhere on disk** — not in `samples/`, not
in `docs/AMAZON_SELECTORS.md`, not in `AMAZON_DOM_REFERENCE.md`. The one "Radius" reference
(`AMAZON_DOM_REFERENCE.md` §"Form structure", *Section 2 Location — Origin select + Radius*) is
the **Create Order / Post-a-Truck form**, a different page. **The anchor, the raw value format
and the empty/mid-edit behaviour are therefore UNKNOWN and must be captured before anything is
built on them.**

What IS known about the surrounding markup, and it is bad:

1. 🔑 **Amazon UNMOUNTS the filter panel when it is collapsed.** `div.filters__column` is
   *absent entirely*, not hidden — captured 2026-08-05, both states, same session.
2. 🔑 **We collapse it ourselves on every loop START** (`content.js` → `closePanelsForStart()` →
   `collapseFilterPanel()`). So for the whole time city assignment matters, a radius control
   that lives inside that panel **is not in the DOM at all**. That is absence, not fragility.
3. If the radius is instead a **chip** (like `Origin city: …` or `Payout (min): 500`), chips do
   survive the collapse — that is how the origin cities are read today. **But no radius chip is
   recorded**, and a radius may not be removable/chip-shaped at all.
4. Any chip read is anchored on **English user-facing text** and would inherit the limitation
   `ORIGIN_CITY_PREFIX = 'Origin city: '` already has across the **11 Relay domains**
   (ca, co.jp, co.uk, com, cz, de, es, fr, it, in, pl).
5. The wrappers are `css-<hash>` (`div.css-1w1nhw5 > div.css-e7fmj9 > span`) — unusable. **Three
   June 2026 attempts died on hashed selectors.**

#### R2 — the request: unknown, but the hook already exists and does NOT touch the settled path

The concept exists in Amazon's own API: the PAT upsert carries
`originCityRadius: { value: 50, unit: "mi" }` — confirmed from a live capture.

⚠ **Whether `/api/loadboard/search` carries the radius in its REQUEST cannot be known from what
is on disk.** We have never captured a request body. Do not assume it does.

What it would take: `window.fetch` is **already wrapped** in `content/networkObserver.js` and
**already receives `arguments[1]`** — it reads `init.signal` and nothing else. Two shapes:

| call shape | body location | cost |
|---|---|---|
| `fetch(url, { body: '…' })` | `init.body`, **already a string in hand** | synchronous, free, no clone, no stream consumption |
| `fetch(new Request(url, { body }))` | a **ReadableStream** on the Request | needs `clone()` — the same tee hazard that killed response cloning |

**Which shape Amazon uses is not recorded on disk.**

🔑 **REQUEST CAPTURE DOES NOT TOUCH THE RESPONSE MACHINERY.** The `Response.prototype.json`
piggyback (`api-samples.md` §6.8) is installed separately by `installResponseReadHook()` and is
unrelated to the fetch wrapper. Request reading sits **beside** it, in `window.fetch`. Nothing
about the hard-won response path changes.

#### R3 — units: two vocabularies already, and non-.com is UNKNOWN

⚠ **Amazon uses two different unit spellings in its own API.** `/search` responses use
`unit: "miles"` (`deadhead`, `totalDistance`, per-load `distance`); the PAT upsert uses
`unit: "mi"` (and `distanceUnit: "mi"`, documented as *lowercase, not `MILES`*). **Any radius
read must carry its unit, never assume one.**

⚠ **Every capture on disk is from a `.com` board.** What a `.de` / `.pl` / `.co.jp` board emits —
`kilometers`, `km`, or still `miles` — **cannot be determined from what is on disk.** Amazon does
emit metric units in this API for other quantities (`"unit":"kilograms"` on weight), which is a
reason to expect locale variation but is **not evidence** of it for distance. Our maths is miles
(`CITY_ASSIGN_EARTH_RADIUS_MI = 3958.8`).

#### R4 — when it changes

| source | how we would notice | stale risk |
|---|---|---|
| **chip** | `originCities.js` already observes the filter area (200 ms debounce); assignment re-runs per cycle | low |
| **inside the panel** | **we could not** — we collapse it and Amazon unmounts it | **silent and indefinite** |
| **request** | re-read on the next `/search`, i.e. every refresh | **structurally impossible** — nothing is cached |

⚠ **A stale radius is not a cosmetic risk.** Stale-too-large re-creates the HEBRON 122 mi false
positive; stale-too-small re-creates the six *"Origin not determined"* false negatives. Both are
the defects this would exist to remove.

#### R5 — the option nobody had noticed: the answer may already be in memory

The `/search` response already carries, per work opportunity,
`deadhead: { value, unit: "miles" }` — **Amazon's own distance from the load to the NEAREST
selected origin city** (that is exactly why the per-city deadhead substitution exists). Every load
Amazon returns is, by definition, within the dispatcher's radius of some selected city. So
**`max(deadhead)` across the rendered board is a lower bound on the radius, needing no DOM read,
no request capture and no new machinery** — the data is already in `_cityRecordById`.

⚠ **Its failure modes, stated plainly:** it is a *lower* bound, so on a board whose farthest
returned load is 40 mi it under-estimates a 250 mi radius; it can only grow within a search
unless reset when the search changes; and it is **not known** whether the `recommendations`
endpoint ("Recently added") honours the radius filter at all — **there is no recommendations
sample on disk to check.**

**It also cannot answer WHICH cities a load is in range of** — membership still needs a real
number. What it does fix outright is the false-negative half: a load Amazon returned should never
be called *"Origin not determined"* on distance grounds.

⚠ **If the DOM is ever chosen, "fall back to 150" is NOT acceptable** — that silently
re-creates the exact defect. The fallback must be visible: mark the radius as unknown and say so.


### 0z. ✅ UNASSIGNED LOADS ARE "ALL" ONLY — fixed 2026-08-20 (Ihor, safety)

A YORK, PA load appeared under the HEBRON, KY tab. Both categories of unassigned —
"never captured" and "captured but beyond 150 mi of every city" — were shown under **every** tab,
and only the first was counted on the All badge.

Now: hidden under every city tab, visible under **All** with a marker, and **both** counted.

🔑 **RULE 9 IS REFINED, NOT OVERTURNED** — see HANDOFF §4 rule **9a**. Unassigned loads are still
visible and still counted; "visible" now means *in All*. Restoring "never hidden" re-creates the
defect.

⚠ **`CITY_ASSIGN_MAX_MILES` was NOT touched.** Whether 150 is the right number is PLAN 16 and
Ihor has not decided it. Do not treat the new WHY-UNASSIGNED lines as an argument for changing
it — they exist to say *why*, not *what the limit should be*.

### 0aa. ⏸ DEFERRED — the panel does not render on an abnormally wide card (2208px)

Ihor has identified the likely cause himself: he keeps DevTools **docked to the right**, which
changes the card width as he drags it. **This is not a board condition.**

**Do not investigate.** Revisit only if it appears with **DevTools closed**.


### 0y-FIXED. ✅ AUTO-OPEN — BOTH failures fixed 2026-08-20, and the tab-visibility theory is DEAD

📏 **TAB VISIBILITY IS NOT THE CAUSE. CLOSED — do not re-open.** Ihor's five measured attempts:
successes and failures in **both** foreground and background tabs (`fg worked` · `bg worked` ·
`bg worked` · `fg FAILED` · `bg FAILED`). The three successes were identical — target a `<p>`
six hops below `div.load-card`, card box 1440x72, highlight and panel both true.

**FAILURE 1 — no `div.load-card` ancestor on the recently-added card.** Fixed by resolving the
card through cityAssign's id-shape rule (`resolveCardForNode()` → `readMainCardElements()`).
🔑 **The rule is REUSED, never copied.** ⚠ **It does not anchor on `wo-card-header--highlighted`**
— that is a STATE class, not a card class.

⚠ **THERE WERE THREE INSTANCES, NOT ONE:** the click handler (card did not resolve), the load id
(the first `div[id]` can be a badge like `STARTING_SOON`), and **the anchor check
`findLiveOutermostCard()`** — which still refused to render after the other two were fixed. Found
only because the suite renders END TO END. If this defect family recurs, look for a **fourth**
class-based lookup before assuming the rule is wrong.

**FAILURE 2 — a 0x0 card.** `hasLayoutBox()` gates the dispatch on both the card and the target;
no box ⇒ retry one frame, bounded at `AUTO_OPEN_LAYOUT_ATTEMPTS = 10`, then give up cleanly.
⚠ **rAF is suspended in a background tab**, so the retry falls back to a 16 ms timer when hidden —
otherwise this fix would have hung every hidden tab silently.

**THE COORDINATES.** `target.click()` → a constructed `MouseEvent` at the target's centre.
`.click()` takes no arguments, so coordinates were 0 by definition. Still ONE click, same gates,
no pointer/mouse-down sequence added. `docs/SAFETY.md` Click 2 updated.

### 0y-was. 🔬 AUTO-OPEN SOMETIMES DOES NOT OPEN THE SHEET — instrumented 2026-08-20, NOT fixed

Ihor, live board: manual clicks open Amazon's detail sheet every time; the programmatic
auto-open click sometimes does not, especially — but not only — in a background tab.

**Read from source, before any board data:**

🔑 **Our click-zone guard CANNOT be the cause as originally framed.** `initManualToggle()` calls
neither `preventDefault` nor `stopPropagation` — Amazon gets the event regardless. The guard only
decides whether OUR panel renders, and on this path it never renders anyway (zero
`showInlinePanel` calls in `content.js`).

⚠ **But `detailOpener.js` has a fallback that dispatches AT THE CARD CONTAINER:** when
`elementFromPoint` resolves outside the card, `target = el`. Amazon was measured on 2026-08-19 to
**ignore container-targeted clicks**. Same condition, different mechanism — Amazon's
indifference, not our interception.

⚠ **The 250 ms settle is a `setTimeout`,** which Chrome clamps to ≥1 s in a background tab and
≥60 s under intensive throttling. Late settle ⇒ more chance React replaced the card ⇒ the detach
bail fires and **no click is sent at all**.

⚠ **A third possibility neither cause covers:** `loadParser.js:195` accepts
`div.wo-card-header--highlighted` as a card, so `load._element` may not be a `div.load-card` at
all.

**Decision belongs to Ihor** — narrow the guard, change the dispatch target, or neither. Do not
fix this from the source reading alone; the instrument exists to say which one actually happens.
See TC-AUTODIAG for the run.

### 📏 0w. MEASURED — how much refreshing Amazon actually tolerates (Ihor, 2026-08-20)

**This is a measurement from a live board, not an estimate.** Ihor deliberately provoked the
throttling with real tabs on a real account:

| tabs at 2.5s | result |
|---|---|
| **two** | ran **indefinitely** — no throttling at all |
| **three** | **immediate 503**, block lasting **over 15 minutes** |

Derived: Amazon tolerates roughly **one request per 1.25s** and refuses at roughly **one per
0.83s**. The block is long — **10–15 minutes and more** — which is precisely why a *late* stop
costs nothing and a *false* stop costs loads.

✅ **The auto-stop and the top-bar message are CONFIRMED WORKING on a real board** in the same
run, with the correct wording. PLAN 10 is closed on evidence, not on argument.

⚠ Do **not** turn these numbers into a pre-emptive warning about tab count or refresh speed —
that is deliberately not built (see 0u). They are here so nobody re-derives them by getting a
dispatcher blocked again.

### 0x. ⏸ OUT OF SCOPE — the accordion does not open in a BACKGROUND tab (2026-08-20)

Ihor saw the inline accordion fail to open while the tab was not focused. **Deliberately not
diagnosed:** he will re-test it first, because the earlier PLAN 7b work (auto-open stops the
refresh loop *before* it opens) changed the timing here and the observation may predate it.

**Do not start on this until Ihor confirms it still happens.** When he does, the first questions
are whether `flashTabAlert` / auto-open are gated on `document.hasFocus()` and whether a
background tab is being throttled by Chrome, not by Amazon.

### 0v. ✅ AUTO-STOP THRESHOLD — three consecutive, added 2026-08-20

The stop waits for **three consecutive** rate-limit responses, not one. Ihor: a false stop costs
money while other dispatchers take the loads; a late stop costs nothing because the throttle lasts
10-15 minutes either way.

🔑 **It reuses `backoffStepIndex`** — already "consecutive rate-limit responses, reset by any
success", already in the limiter state, already shared across tabs. **No second counter exists and
none should be added.**

⚠ **Backoff and stop are decoupled:** backoff on the first response (`background.js`, unchanged),
stop + message on the third (`content/sidebar.js`). Do not re-couple them — the dispatcher must
never be shown a message about a pause that did not happen.

### 0s. ⏸ SHARED CROSS-TAB REFRESH LIMIT — deferred to a later release, NOT deleted

Ihor's decision, 2026-08-20: the toggle is removed from the UI and the feature ships **off**.
Silently slowing refreshes while the bar says "Refresh every 2.5s" reads as broken, not as
protection; dispatchers know Amazon throttles and manage their own tab count.

**Everything still exists:** `grantOrDenyPermit()`, the global `lastGrantedAt` floor, the FIFO
`permitQueueTail`, `getGlobalPacingFloorMs()`, the active-tab registry, and `popup.js`'s
null-guarded wiring. **Re-enabling is one constant** — `SHARED_LIMIT_SHIPS_ENABLED` in
`content.js` — plus restoring the toggle markup in `popup.html`.

⚠ **Backoff is NOT part of this and must never be made optional.** It is checked before the
shared-limit branch and still pauses every tab.

### 0t. 🔜 NOTIFICATION CENTRE IN THE POPUP — Ihor wants it, separate UI task

A badge with an unread count, hover to read. Out of scope for the 2026-08-20 work, which
deliberately put the throttling message in the top bar where the dispatcher is already looking.
The message text and its tone requirement would carry over unchanged.

### 0u. ❌ PRE-EMPTIVE WARNINGS ABOUT REFRESH SPEED OR TAB COUNT — deliberately NOT built

They contradict 0s: we no longer count tabs or slow the dispatcher down, and warning before
anything has happened would **alarm without cause**. Recorded so it is not proposed as an
improvement later.

### 0p. 🔴 P/R DETECTION — measured 2026-08-19, NOT in the record. Needs a labelled capture.

Across **159 work opportunities / 506 stops**, **nothing** in a `/api/loadboard/search` response
distinguishes a Provided load from a Required one. No `AMAZON_PROVIDED`/`CARRIER_OWNED` value,
no bare `"P"`/`"R"`.

#### ❌ `assetOwner` — REFUTED 2026-08-19. Tested and ruled out. DO NOT RE-DERIVE.

**Two records with a KNOWN P badge carry DIFFERENT values:** `72e5184e` = `"AZNG"` (badge read
from `samples/paired-card.html`) and `4c0565e4` = `"NCSL"` (Ihor confirmed live). A non-null or
non-Amazon `assetOwner` does **not** mean carrier-owned, in either direction. It is also unusable
in principle: 42 of 159 work opportunities carry two different owners across their own stops.

Also refuted: `containerOwner == "EMPTY_CONTAINER_ID"` (`4c0565e4` has it, `72e5184e` — also P —
does not). Cannot discriminate: `stopRequirementType` is `"CONTAINER"` in 146/146.

#### ❌ C1 — "any stop LIVE means R". REFUTED 2026-08-19 by Ihor's board.

Three **P** cards showed loading *Live/Drop*. Dead.

#### ❌ C5 — "any DROP means P, all-LIVE means R". REFUTED 2026-08-19 by Ihor's board.

Two **R** cards showed loading *Live/Drop*:
COLUMBUS, IN → GROVEPORT, OH and TOTOWA, NJ → HAZLETON, PA.

🔴 **Loading type does not determine the badge in either direction. Do not propose another
loading-type rule.**

#### 🔴 THE ANSWER: THE RESPONSE BODIES CANNOT DETERMINE THIS (api-samples §11)

- **The request side is not captured.** `networkObserver.js` reads `init` only for `.signal`.
  The response does not echo the request either.
- **The record cannot encode the variant.** Amazon's filter chips read "53' Trailer **(R)**" — the
  marker is on the *filter option* — but both variants serialise to the same
  `loads[].equipmentType`.
- **The labelled set inside the captures is 1 P, 0 R.** Only one captured card file exists. With no
  labelled R, **no field can be confirmed, only refuted** — which is how every hypothesis has died.
  83 fields vary; 63 are consistent with the single labelled P. Enumeration is not a path forward.

#### ⚠ IMPLEMENTED 2026-08-20 — THE INTERIM DOM DEPENDENCY (authorised by Ihor)

PAT now derives trailer ownership from the card's P/R badge letter:
`div.trailer-type-circle > p` → `loadParser.js:84` → `trailerLetter` → `getTrailerLabel()` →
`patTrailerLetter()` in `patModal.js`. **P → AMAZON_PROVIDED, R → CARRIER_OWNED**, anything else
blocks Confirm with the value named.

🔴 **THIS IS THE ONLY DOM-SOURCED FIELD IN THE PAYLOAD AND IT BREAKS THE STANDING DIRECTIVE.**
**DELETE IT when either happens:** (1) the record-based rule is found — the label collection below
exists to find it; or (2) Ihor's backend supplies trailer ownership directly. **Do not extend the
pattern to any other field.**

⚠ **`"R"` has never been observed in a captured card.** The R branch is unverified until a real R
post is confirmed on Amazon. The modal logs a warning whenever it fires.

#### ✅ PART 2 — LABEL COLLECTION IS LIVE (2026-08-20)

Every parsed card's badge letter is filed beside its captured record under the same id, sharing the
record's eviction and teardown. In-memory only. Dump with:

```
__EXT_DEBUG.dumpTrailerLabels()
```

**Works at the shipped `DEBUG_LEVEL`** (uses `console.*`, not `logger.*`).

**How many are needed:** 83 fields vary. R labels are worth ~12× a P label because the R-side
groups are only 10–20% of the board. Expected chance survivors ≈ 83 × 0.15^(R labels): **3 R makes
it conclusive, 5 R gives margin.** P accumulates for free.

#### superseded — the costing below is now implemented

`div.trailer-type-circle > p` → `loadParser.js:84` → `trailerLetter` → `loadStore`. **Already
read today.** PAT could use `loadStore.getLoadUnit(loadId).trailerLetter`, mapping
**P → AMAZON_PROVIDED**, **R → CARRIER_OWNED**, anything else → Confirm disabled with the raw value
named. ~10 lines plus tests.

⚠ **Two things Ihor must weigh before authorising it:**
1. It would be **the only DOM-sourced field in the payload**, against the "one id plus one API
   record" directive. It must be flagged in code as an interim dependency to delete when his own
   backend supplies trailer ownership.
2. **`"R"` has never been captured in a card** — only `"P"`. The R branch would be unverified
   until an R card is captured.

**The alternative that keeps the directive intact:** capture the `/search` **request** body
(a change to `networkObserver.js`) and see whether the equipment filter distinguishes the
variants. That answers E1 properly instead of working around it.

#### superseded — the ranked hypotheses below are all dead or unconfirmable

| # | would mean R | loads |
|---|---|---|
| **C1** | any stop `loadingType: "LIVE"` | 15/146 |
| C2 | `existingSubCarrierName` not purely AZNG | 29/146 |
| C3 | any load `isExternalLoad: true` | 24/146 |
| C4 | container equipment | 15/146 |

**C1 leads: it is the only one with a mechanism.** PRELOADED = trailer already loaded and waiting
(Amazon supplied it); LIVE = loaded while the driver waits (carrier brought its own). It matches
the upsert tie in §8a — `AMAZON_PROVIDED` → `["DROP"]` 7/7, `CARRIER_OWNED` → `["LIVE"]` 4/4 —
and **half of it is already confirmed**: the §10b card reads *Drop* and its badge is **P**.

#### ✅ THE ONE QUESTION THAT SETTLES IT

**On today's board, find any card whose Loading Type reads "Live" (not "Drop") and report the
letter in its circle badge.** No id hunting, no JSON — the card shows both. If it reads **R**, C1
is confirmed and C2/C3/C4 are all weakened at once. If it reads **P**, C1 is dead.

*(If ids are preferred, these each isolate ONE hypothesis:*
`353f4243-db07-4e11-be6f-481211f647a1` *tests C1 alone;*
`22007757-0cc6-4cea-8f66-095f48dbe9e3` *tests C2 alone;*
`d3dad208-14dc-4296-acef-0ff73e05fcbf` *tests C3 alone. They are days old and may have expired,
which is why the "any Live card" question is better.)*

### 0q. ✅ CLOSED 2026-08-20 — it was a sampling artefact, not a rule

Power only + "Live or Drop & Hook" produces `loadingTypeList: ["LIVE"]`, captured from the live
form. The `AMAZON_PROVIDED` → `["DROP"]` (7/7) correlation held only because Ihor had left the
Load control on "Drop & Hook" for those captures. **Our `AMAZON_PROVIDED` + `["LIVE"]` pairing is
legitimate; no change needed.** Do not resurrect the 7/7 correlation as evidence.

---

#### superseded — the original decision request

### 0q-was. DECISION FOR IHOR — loading type vs trailer ownership

The eleven captures tie the two together: `AMAZON_PROVIDED` → `["DROP"]` (7/7),
`CARRIER_OWNED` → `["LIVE"]` (4/4). The UI finding explains why: the **Load control exists only
under "Power only"**, so for box truck and tractor-and-trailer the form has no Load section and
`LIVE` is simply what it sends.

**This conflicts with the standing rule "always Live or Drop & Hook".** ⚠ PAT today sends
`AMAZON_PROVIDED` + `["LIVE"]` — **a combination that appears in none of the eleven captures.**

Three options, Ihor's call:
1. **Keep the standing rule** — always `["LIVE"]`, accept that it does not match what the form
   sends for Amazon-provided loads.
2. **Follow the captures** — derive it from ownership: Provided → `["DROP"]`, Required →
   `["LIVE"]`. Requires 0p first.
3. **Send `["DROP"]` for everything**, matching what 7 of 11 captures did.

### 0r. ✅ CLOSED 2026-08-19 — the 53' Trailer array is fully captured and MATCHES the constant

Ihor expanded it in DevTools, twice, once per order type: exactly five elements, identical for both.
**Byte-identical to `PAT_EQUIPMENT_TYPES_53`** (captured 2026-07-14), so **no code change was
needed** and 53' Trailer has been mapping correctly all along. The "unverified five-value list"
doubt below is resolved. Pinned by `patalign-suite` section 9 so it cannot drift.

Both order types send the same array — only `providedTrailerType` differs — so equipment work and
P/R detection (0p) stay separable.

---

#### Original entry, retained

### 0r-was. ⚠ 53' TRAILER CANNOT BE MAPPED — its equipmentTypes array is truncated

Both captures containing `FIFTY_THREE_FOOT_TRUCK` show a multi-value array cut short:
`["FIFTY_THREE_FOOT_TRUCK", "SKIRTED_FIFTY_THREE_FOOT_TRUCK", "FIFTY_THREE_FOOT_DRY_VAN", …]`.
**It is the most common equipment on the board** — 235 of 251 loads on disk. Ihor is re-capturing
the expanded array. **Do not guess the missing elements.**

⚠ Note `patApi.js` already defines `PAT_EQUIPMENT_TYPES_53` with five values from the 2026-07-14
capture (api-samples §3). Whether that five-value list matches the current truncated one is
**unverified** — the re-capture should settle it.

### 0m. ✅ CLOSED 2026-08-19 — a Team load now posts ["TEAM"]

Ihor captured a real upsert containing `driverTypes: ["TEAM"]`
(`samples/pat-upsert-team-26ft-carrier-owned.json`, api-samples §7). The token that blocked this
now exists, so `TEAM_DRIVER → ["TEAM"]` and Confirm is enabled for a team load. Detection was
already solved; only the posted value was missing.

---

#### Earlier state, retained

### 0m-was. 🟠 A Team load posts as Driver = Solo — HALF FIXED 2026-08-19

**FIXED: it can no longer post as solo.** The driver type is now derived from
`transitOperatorType` (`SINGLE_DRIVER` → `["SOLO"]`), the modal shows the derived value
read-only, and anything unmapped blocks Confirm with the raw value named.

🔴 **NOT FIXED: a team load still cannot be POSTED — it is blocked instead.** The upsert's
`driverTypes` value for a team post is on **no** capture, sample or doc (`api-samples.md` has
only `["SOLO"]`), and the board's `TEAM_DRIVER` is a different API's vocabulary. No enum was
invented.

**NEEDED FROM IHOR — one capture: a manual Post-a-Truck upsert made with Team selected.** Read its
`driverTypes` array, add the constant to `patApi.js`, drop it into
`PAT_DRIVER_BY_TRANSIT_OPERATOR.TEAM_DRIVER.types`. One line, and 0m closes.

---

#### Original diagnosis, retained

**Reported live by Ihor.** A load whose card shows **two driver icons**, and whose Amazon panel
says **Team**, produces a post with **Driver = Solo**.

⚠ **This is more dangerous than the city defect.** A wrong city BLOCKED the post and Ihor saw it.
A wrong driver type blocks nothing — **it posts silently and wrongly.**

#### D1 — where the value comes from today: NOWHERE. It is hardcoded, twice.

| what | file:line | value |
|---|---|---|
| posted payload | `content/patApi.js:387` | `driverTypes: ['SOLO']` — a literal in `buildPatPayload()`, **not** taken from `formState` |
| modal display | `content/patModal.js:1129` | `driverVal.textContent = 'Solo'` — a literal in a `.pat-static-val` div, **no listener, no control** |

It is not read from the record, not read from the card, and not a UI control that merely defaults
to Solo. `formState` carries no driver field at all.

#### D4 — long-standing defect, NOT a regression

`git log -S"driverTypes" -- content/patApi.js` returns **exactly one commit**: `512381d`, which
introduced it as `['SOLO']`. It has never had any other value and was never load-derived. **The
re-sourcing did not cause this.** Docs corrected accordingly.

#### D2 — what the record carries: the right field exists, but no team load is on disk

Every key path in all **159** captured work opportunities was scanned.

| finding | result |
|---|---|
| `transitOperatorType` (top level) | **present in 159/159** |
| its distinct values | **`"SINGLE_DRIVER"` × 159 — no variation whatsoever** |
| any path whose VALUE is ever `TEAM` or `SOLO` | **none, anywhere** |
| other name-matching paths | only `searchChannelStampedDuration.operator`, which is numeric duration noise |
| in `projectRecord()`'s projection? | **it was not** — added 2026-08-19 for the diagnostic only |

🔴 **NEEDED FROM IHOR — a capture of a known TEAM load's `/api/loadboard/search` response.**
`transitOperatorType` is the only candidate, but **every capture on disk is a solo load**, so the
team value is unknown and must not be guessed. `samples/` is gitignored, so it cannot be recovered
from the repo.

#### D3 — what PAT accepts

`buildPatPayload()` writes `driverTypes` as an **array of strings**. `api-samples.md` records
exactly one observed value: `["SOLO"]`. 🔴 **The TEAM enum for the upsert is also not on disk.** So
two separate unknowns must be captured before this can be fixed:
1. what `transitOperatorType` reads on a team load — to DETECT it;
2. what `driverTypes` must contain for a team post — to SEND it.

A capture of a **manual Post-a-Truck upsert made with Team selected** answers (2).

#### The measurement is wired

`PATDIAG DRIVER` (behind `CITY_ASSIGN_DEBUG`) prints, on every modal open: the record's raw
`transitOperatorType`, the value PAT will post, and whether they agree — flagging **** NO ****
loudly for anything that is not `SINGLE_DRIVER`.

### 0n. 🔴 An R load posts as Provided — CONSTANTS SETTLED, DETECTION IS THE BLOCKER (2026-08-19)

**Both values are now capture-backed:**
`PAT_TRAILER_AMAZON_PROVIDED = 'AMAZON_PROVIDED'` (api-samples §3) and
`PAT_TRAILER_CARRIER_OWNED = 'CARRIER_OWNED'` (§7). **No further capture of the constants is
needed** — the brief expected P to be the gap; it was not.

🔴 **THE ACTUAL BLOCKER: nothing in the record says which one a load is.** Every
trailer/owner/carrier/asset-named field across all 159 captured work opportunities was enumerated;
none distinguishes carrier-owned from Amazon-provided. `trailerDetails[].assetId/.assetType/
.assetSource` are null in all 253 entries (BACKLOG 5) and `.assetOwner` is a carrier code.

**So P/R was deliberately NOT wired** — an R load still posts `AMAZON_PROVIDED`.

**NEEDED FROM IHOR:** the `/api/loadboard/search` response for a load whose card shows the **R**
badge, so the field that marks it can be found. Without it there is nothing to branch on.

---

#### Original entry, retained

### 0n-was. 🔜 NEXT TASK — an R load posts as Equipment = Provided

**Reported live by Ihor 2026-08-19.** A load with the card badge **R**, whose Amazon panel says
**Required**, produces a post with **Equipment = Provided**. The summary line currently hardcodes
`(Provided)` and `providedTrailerType: "AMAZON_PROVIDED"` is a constant in the payload.
Related to 0l (P/R handling) and distinct from PLAN 8 (unsupported equipment types).

### 0o. `normalizeState()` in patApi.js still has a first-two-letters fallback

`return STATE_NAME_TO_CODE[s.toLowerCase()] || s.toUpperCase().slice(0, 2);` — the heuristic
that would map "New York" to NE (Nebraska). It is reachable **only** from
`resolvePATCity`'s board-string branch, and PAT always passes a `{city, state}` object now, so
it is **off PAT's path**. Left alone as out of scope for the city-resolution fix. Its table also
has **no Canadian provinces**, unlike the new `PAT_STATE_CODE_BY_NAME`. Worth deleting or
redirecting when someone next touches `patApi.js`.

### 0i-FIXED / 0k-DECIDED. PAT modal crash, silence, and loading type — 2026-08-19

**0i (crash)** — `ReferenceError: equipment is not defined` fixed; the value now comes from the
record like every other field.

**0i-b (silence)** — fixed at the class level, not just this instance: `openPostModal` has a
top-level try/catch that logs message + stack + loadId, the dispatcher sees a failure dialog, and
the caller handles the rejection. **This is the rule to carry forward: any function that can throw
behind a user action needs a catch that logs AND a visible signal.**

**0k (loading type)** — CLOSED by Ihor's decision: always post "Live or Drop & Hook". No longer an
open question. `resolveLoadingType()` deleted.

**One item remains open, and it is the only unverified byte in a live post:**

⚠ **`["LIVE","DROP"]` has never been captured.** `api-samples.md` records only `["LIVE"]` and
`["DROP"]` for `loadingTypeList`. The pair is inherited from the old `resolveLoadingType`
inference, not from a capture. **Needed from Ihor: a capture of a manual Post-a-Truck upsert made
with the "Live or Drop & Hook" option selected**, to confirm the exact array Amazon expects. Until
then, a rejected or silently-narrowed post is the symptom to watch for.

### 0l. Provided vs Required (P/R) handling — NEXT TASK, deliberately not touched

The summary line still reads `Equipment: <label> (Provided)` with "Provided" hardcoded. Out of
scope for the 2026-08-19 fixes by instruction. Recorded here so it is not lost.

### 0i. ✅ FIXED 2026-08-19 — PAT modal crash and silence (heading corrected 2026-08-24)

⚠ **Stale heading, corrected.** Ihor confirmed the modal opens on both a P and an R load,
2026-08-20.

**Cause, proven by running the real `openPostModal` against a real sample record:**

    ReferenceError: equipment is not defined
        at openPostModal (content/patModal.js:1008)

Line 1008 is `summaryEl.textContent = "Equipment: " + equipment + " (Provided) Loading Type: " …`.
The 2026-08-19 re-sourcing replaced the preamble that declared `var equipment = loadUnit.equipment`
and did not re-declare it. **It is a display string in the modal summary — it feeds no posted
value.** Everything before it works: PATDIAG SOURCE reports `missing: none`, and the trace shows
`removePatModal` and two `makeTimeStepper` calls completing before the throw.

**How it was missed:** the verification grep after the rewrite checked a hand-picked list of
variable names, and `equipment` was not on that list. `patsource-suite` tested
`patSourceFromRecord()` in isolation and never called `openPostModal()` end to end — the same
gap that let the inline panel ship unwired in Stage B. **The regression test must invoke
`openPostModal` and assert a modal node exists**, not assert on the helpers.

#### 0i-b. The silence is a SEPARATE defect — code rule 5 is violated on this path

`openPostModal` is `async` and has **no top-level try/catch**; the caller does
`openPostModal(sheetLoadId);` with no `await` and no `.catch()`. Any throw is an unhandled
promise rejection: **0 `logger.error` calls**, nothing visible. That is why Ihor saw "no modal, no
error" and why smoke item (f) still passes. Any function that can throw behind a user action needs
either a top-level catch that logs, or a caller that handles the rejection.

### 0j. M1 — origin/destination derivation is CORRECT (verified 2026-08-19, no defect)

`patSourceFromRecord()` reads `lastLoad = loads[loads.length - 1]`, then
`lastStop = lastLoad.stops[lastLoad.stops.length - 1]` — **the last stop of the LAST element of
`loads[]`, not of `loads[0]`.** Measured across **71 multi-segment records**; in the **63** where
the two differ, PAT's destination matched the last load's last stop **63/63**. Worked example:
`3a45d54c` origin TOLEDO, OH — `loads[0]` last stop PERRYSBURG, Ohio (what a `loads[0]` bug
would give) — `loads[N]` last stop **GARNER, NC** — PAT dest **GARNER, NC**.

**So "origin and dest both MONROE, Ohio" is not this bug.** `origin === dest` occurs legitimately
in **5 of 71** multi-segment records — a round trip returning to the same facility. ⚠ Ihor's case
had **7 stops**, and no 7-stop record exists in `samples/`; the largest on disk are 2+2. **If it
still looks wrong, send that load's id and a capture of its `/search` response** — it cannot be
checked further from disk.

### 0k. M2 — loadingType: the change altered what PAT posts. Ihor's call. NOT changed.

**Where the record value comes from:** the **last stop of the last load**'s `unloadingType`. Across
all captures only two shapes exist: `first.loadingType=PRELOADED | last.unloadingType=DROP` (149)
and `… | LIVE` (5).

**What the card's string represents:** the board's own combined label. It is NOT the same
vocabulary — `"Live/Drop"` and `"LTL/Live/Drop"` describe the handling across the whole load,
not one stop.

**What PAT sent BEFORE vs NOW** — measured by running `resolveLoadingType()`:

| card string | BEFORE (from the card) | NOW (from the record) |
|---|---|---|
| `"Drop"` | `["DROP"]` | `["DROP"]` — same |
| `"Live"` | `["LIVE"]` | `["LIVE"]` — same |
| `"Live/Drop"` | **`["LIVE","DROP"]`** | **`["DROP"]`** — ⚠ CHANGED |
| `"LTL/Live/Drop"` | **null → PAT refused to post** | `["DROP"]` — ⚠ now posts where it used to block |

**Both directions matter and neither is ours to choose.** The record can only ever express ONE
value, so `["LIVE","DROP"]` is no longer reachable. Conversely a load PAT used to refuse now
posts. **Question for Ihor: for a load the board labels "Live/Drop", should the post carry
`["LIVE","DROP"]` or `["DROP"]`?** Nothing on disk answers it — the upsert captures only ever
show `["LIVE"]` or `["DROP"]`, never both.

### 0h-FIXED. Post-a-Truck re-sourced from the captured record — 2026-08-19, awaiting Ihor's re-test

The PLAN 29a regression is fixed in code. PAT reads `getLoadRecord(loadId)` and nothing else: no
card DOM, no detail sheet. D1 (−30 min), D2 (+3 h), D3 (`stopCount`), D4 (ISO instant + IANA zone)
implemented as specified; ×1.10 markup and ±25-mile window unchanged. 154/154 captured records
resolve with nothing missing.

**🔴 Smoke item (e) remains FAIL until Ihor re-tests on a real board.** See TC-PAT-RECORD.

**Open items this created, none blocking:**

1. **Two equipment enums have no mapping and cannot get one from disk.**
   `FORTY_FOOT_CONTAINER` and `TWENTY_SIX_FOOT_BOX_TRUCK` are in `patApi.js` but appear in no
   capture. They now route to the unsupported-equipment modal with the raw enum logged.
   **Needs from Ihor: a capture of a board carrying 40' Container or 26' Truck.** (`samples/` is
   gitignored, so this cannot be recovered from the repo.)
2. **`Live/Drop` may no longer be expressible.** The old card path could produce
   `['LIVE','DROP']` from a "Live/Drop" label. The record's last-stop `unloadingType` is a single
   enum, and no mixed case appears in any capture. If Ihor ever sees a load the board labels
   "Live/Drop", PAT will now report an unresolved loading type rather than guess. **Send that
   load's id.**
3. **Manual time edits still use one offset for the session.** `patZoneAt()` resolves the offset at
   the load's own instant — correct for the load — but if a dispatcher drags the time across a DST
   boundary by hand, the offset applied is the load's, not the edited time's. Pre-existing
   behaviour, unchanged, and now at least starting from the right offset.
4. **`stopCount` semantics still unconfirmed against the old sheet value.** PAT posts it as
   `maxNumberOfStops`. D3 says it must equal the card's stop count — step 6 of TC-PAT-RECORD is
   the check.

### 0h. ✅ FIXED 2026-08-19 — POST-A-TRUCK re-sourced (heading corrected 2026-08-24)

⚠ **Stale heading, corrected.** PAT is fully re-sourced from the captured record and verified
against eleven real upserts.

**Confirmed live by Ihor 2026-08-19. Smoke item (e) FAILS. The docs previously implied PAT works;
they were wrong.** The modal opens, the STOPS field and both date/time fields are empty, the two
warnings "Load times could not be read" and "Stop count could not be read" are shown, and Confirm
never enables.

**Cause: PLAN 29a (Stage A) removed the detail-sheet scrape that PAT read those fields from.**
The removal itself was correct and is not to be reverted. What is missing is the re-sourcing.

⚠ **NOT this bug:** the other modal, "Post creation for this equipment type is not supported yet —
53' Container, 53' Trailer and Chassis". That is **PLAN 8** (R-type / unsupported equipment),
blocked on a captured manual upsert payload. Different modal, different cause. Do not conflate.

#### P1/P2 — field inventory and coverage

`openPostModal(loadId)` reads two stores: **Phase 1** (`loadStore`, written by
`loadParser.js` from the CARD DOM — untouched by Stage A) and **detail** (`loadUnit.detail`,
now written by `inlinePanel.js:1200` as `recordToPanelData(record)`).

| # | Field | Read today from | After Stage A | In the projection? | Path |
|---|---|---|---|---|---|
| 1 | equipment | `loadUnit.equipment` (card) | **INTACT** | PRESENT (as an enum, not the label) | `loads[].equipmentType` |
| 2 | payout | `loadUnit.payoutNum` / `.payout` (card) | **INTACT** | PRESENT | `payout.value` |
| 3 | distance | `loadUnit.distance` (card) | **INTACT** | PRESENT | `totalDistance.value` |
| 4 | loadingType | `loadUnit.loadingType` (card) | **INTACT** | PRESENT (per stop) | `loads[].stops[].loadingType` |
| 5 | boardStops (origin/dest fallback) | `loadUnit.boardStops` (card) | **INTACT** | PRESENT | `loads[].stops[].location.city/.state` |
| 6 | origin city / state | `detail.segments[0].stops[0].address` | INTACT *(path survives)* | PRESENT | `loads[0].stops[0].location.city/.state` |
| 7 | dest city / state | `detail.segments[N].stops[M].address` | INTACT *(path survives)* | PRESENT | last `loads[].stops[].location` |
| 8 | **stop count** | `detail.header.stopsCount` | 🔴 **BROKEN** | PRESENT | `stopCount` |
| 9 | **start time** | `detail.segments[0].stops[0].arrival` | 🔴 **BROKEN** | PRESENT | `loads[0].stops[0].checkIn` + `.tz` |
| 10 | **end time** | `detail.segments[N].stops[M].arrival` | 🔴 **BROKEN** | PRESENT | last stop's `checkOut`/`checkIn` + `.tz` |

**Row 8 — the path no longer exists.** `recordToPanelData()` returns `stopsCount` at the TOP
level; PAT reads `detail.header.stopsCount`. There is **no `header` object at all**, so the
expression yields `''`, `parseInt('')` is `NaN`, and the field is left empty by design.

**Rows 9/10 — the path survives but the FORMAT changed.** PAT's `parsePatStopTime()` requires
`M/D HH:MM TZ` (regex `/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([A-Z]{2,5})/` — it
needs a **slash**). Stage B's `formatStopTime()` emits `"Mon Aug 17 17:30 EDT"`. Run against
each other on the real source:

| Stage B emits | `parsePatStopTime()` returns |
|---|---|
| `"Mon Aug 17 17:30 EDT"` | **null** |
| `"Tue Aug 4 02:43 CDT"` | **null** |
| `"Mon Aug 3 16:15 PDT"` | **null** |
| `"8/17 17:30 EDT"` *(old scrape format)* | `2026-08-17T21:30:00Z` |

#### Coverage, measured across 154 captured work opportunities

`stopCount` 154/154 · `totalDistance.value` 154/154 · `payout.value` 154/154 ·
`deadhead.value` 154/154 · `loads[].equipmentType` 240/240 · `loads[].distance.value` 240/240 ·
`stops[].location.city/.state/.timeZone` 484/484 · `stops[].stopSequenceNumber` 484/484 ·
**`CHECKIN.plannedTime` 484/484 · `CHECKOUT.plannedTime` 484/484.**

**Every field PAT needs is PRESENT. Nothing is ABSENT. No new capture is required to fix the
regression.**

#### P3 — the one thing not in the captures

Only two `equipmentType` values appear on disk: `FIFTY_THREE_FOOT_TRUCK` and
`FIFTY_THREE_FOOT_CONTAINER`. `FORTY_FOOT_CONTAINER` and `TWENTY_SIX_FOOT_BOX_TRUCK` are in
`patApi.js` but have **never been observed in a capture**. This does **not** block the fix —
equipment still comes from the card (row 1, INTACT) — but it does mean an enum→PAT-constant map
cannot be verified for those two from disk. **A capture of a 40' Container or 26' Truck board
would be needed before switching equipment to the projection.** (`samples/` is gitignored.)

#### P4 — binding

No new plumbing is needed for the id. `openPostModal(loadId)` has exactly **one** caller,
`inlinePanel.js:1292`, which passes `sheetLoadId` — the same id the panel is bound to. And
because PAT is only reachable from the panel's action bar, **the panel must already have
rendered**, which by `showInlinePanel()` gate 2 means `getLoadRecord(loadId)` returned a
record. So the record is **guaranteed to exist** whenever PAT opens. `getLoadRecord()` is a
global in the isolated world (`cityAssign.js`), callable from `patModal.js` directly.

Two viable shapes, to be chosen when the fix is scheduled:
- **(a)** PAT calls `getLoadRecord(loadId)` and reads the raw projection — no shared format, no
  reliance on display strings.
- **(b)** `recordToPanelData()` also emits `header.stopsCount` and machine-readable times, and
  PAT keeps reading `loadUnit.detail`.

**(a) is the safer direction** — see P5: it avoids parsing values that were formatted for display.

#### P5 — risk, and one question for Ihor

1. ⚠ **Times are posted to the live marketplace.** Today `parsePatStopTime()` **guesses the
   year** (current year, rolled forward if >30 days past) and maps a 3-letter abbreviation to a
   **fixed** offset. The projection carries a full ISO-8601 UTC instant and an IANA zone, so
   re-sourcing removes both guesses — but it **changes the value sent to Amazon**. Across a DST
   boundary a fixed offset and an IANA zone differ by an hour.
2. ⚠ **Equipment label mismatch, concrete.** `PAT_EQUIPMENT_MAP` is keyed `"53' Container and
   Chassis"`; `EQUIPMENT_LABELS` maps `FIFTY_THREE_FOOT_CONTAINER` → `"53' Container"`.
   Routing equipment through the display label would send that load into the "unsupported
   equipment" modal — a silent capability loss. Map **enum → PAT constant directly**, never via
   the display string.
3. ⚠ **Do not re-source payout or distance.** Both are INTACT from the card and PAT applies
   `PAT_PAYOUT_MARKUP_RATE` (×1.10) to payout. Changing the base would change every posted
   price. Out of scope for this regression.
4. ⚠ **`stopCount` semantics are unverified.** PAT posts it as `maxNumberOfStops`. Amazon's
   `stopCount` is the work opportunity's own count; the old value came from the sheet header.
   Nobody has compared the two on the same load.

**QUESTION FOR IHOR, and the fix should not go in without an answer:** on one load, does Amazon's
`stopCount` equal the number the PAT modal used to prefill? And are the prefilled start/end times
expected to be the **first stop's CHECKIN** and the **last stop's CHECKOUT** (rather than
CHECKIN)? Both decide what goes out on a real post, so they are not ours to assume.

### 0f-FIXED. Click-zone mismatch — CLOSED 2026-08-19

A click whose `event.target` IS `div.load-card` (the container's own padding) is now ignored
outright: no panel, no id resolution, no state change, no loop stop. Descendant clicks are
untouched. The rule is target identity, never geometry, and it never tries to detect Amazon's
React listener. See CHANGELOG 2026-08-19 and TC-CLICK-CONTAINER.

**Still owed: a live confirmation.** Centre click must still open the panel with ids matching;
top and bottom edge clicks must produce nothing and **no MISMATCH line**. If a centre click stops
working, the rule is too wide — report it rather than adjusting it.

**Left deliberately unfixed, and worth deciding separately:** `showInlinePanel()` resolves the
load id as the **first** `div[id]` in the card with **no UUID-shape filter**, while cards also
contain `div[id="STARTING_SOON"]`. CLICKDIAG C2 flags it when the resolved id is not a bare UUID.
No live click has yet produced a non-UUID id, so there is nothing to fix from — watch C2.

### 0f. ✅ FIXED 2026-08-19 — CLICK-ZONE MISMATCH (heading corrected 2026-08-24)

⚠ **Stale heading, corrected.** Closed by the container-target guard — the rule is TARGET
IDENTITY, never geometry.

**Reported live.** Clicking the CENTRE of a card highlights it, opens Amazon's side sheet and
expands our accordion. Clicking the very EDGE — a few pixels at the top or bottom — expands
**only our accordion**: no highlight, no sheet update.

**The hazard, and why this is not cosmetic:** the highlighted load and the load our panel is
showing can be DIFFERENT loads, so a dispatcher can read one load's data believing it belongs to
another.

**What the source already shows.** `initManualToggle()` matches with
`ev.target.closest('div.load-card, div.load-card__selected')` — the **card container**. That
matches a click anywhere in the container's box, including its own padding and border. Amazon's
own handler is React-synthetic and **cannot be enumerated from a content script**
(`getEventListeners` is DevTools-only), so what it binds to is not readable — but
`samples/paired-card.html` contains **0 anchors, 0 buttons, 5 `role="img"` and 2
`tabindex="0"`**, so whatever Amazon binds is an inner element, not the container. A click on
container padding therefore reaches us and not Amazon. **This is a hypothesis until Ihor's
CLICKDIAG lines confirm it — do not fix from it.**

CLICKDIAG (C1..C4, behind `CITY_ASSIGN_DEBUG`, passive capture-phase) measures it. See the
2026-08-19 CHANGELOG entry for what to click and which lines to send back.

⚠ Fix candidates exist but must be chosen from the measurement, not guessed: narrow our match to
the same inner element Amazon uses; or require the highlight/sheet to agree before rendering; or
render only when the resolved id matches the selected card. **A wrong choice here makes the
mismatch silent instead of visible.**

### 0g. Membership can exceed the dispatcher's Amazon search radius — PRODUCT DECISION for Ihor

**Measured 2026-08-19:** a load with a **122.9 mi deadhead** was shown under **HEBRON, KY** while
the Amazon search radius was set to **50**.

**Cause:** `CITY_ASSIGN_MAX_MILES = 150` is a fixed constant, independent of the radius the
dispatcher set in Amazon's own filters. Range membership therefore admits loads Amazon's own
search would have excluded. Not a defect in the arithmetic — the two settings simply do not know
about each other.

**The decision is Ihor's, and it is a product decision, not a technical one:**
1. Membership follows the Amazon search radius (read it, mirror it) — one setting, always
   consistent with what the board is showing.
2. Membership stays a separate setting — deliberately wider, so a driver willing to run further
   still sees the load, at the cost of disagreeing with Amazon's own filter.
3. Separate but **configurable**, defaulting to the search radius.

Related to **PLAN 16**. ⚠ `CITY_ASSIGN_MAX_MILES` was NOT changed. Note this also interacts with
BACKLOG 0 (out-of-range loads shown under every tab and absent from the All badge): raising or
lowering the threshold changes how many loads land in that class.

### 0a-FIXED. Filter feedback loop — CLOSED 2026-08-19 by making the deadhead substitution idempotent

Was: every apply removed and re-inserted our deadhead node; those childList mutations woke the
board observer, which re-applied the filter. Now a card already in the desired state receives no
DOM write, and a changed value is written in place. The observer was **not** touched — no
disconnect, no suspension, no re-entrancy flag. See CHANGELOG 2026-08-19 and TC-CITY-IDEMPOTENT.

**Still owed: a live-board confirmation.** If `CITYDIAG Q6 WAKE` still repeats on an idle board
with a city selected, idempotence was not sufficient and something else is mutating the observed
subtree — that is a finding to report, not something to patch over with a guard.

### 0d. 21 filter applies fire from a single city click — NOT fixed, out of scope 2026-08-19

Measured live: one click on a city button produced **21 applies**. The loop accounted for the
repeats, but the first click should produce **one** apply, not a burst. Now that each apply is
cheap and write-free when nothing changed, this is a performance and clarity issue rather than a
correctness one — but nobody has established where the 21 come from. Worth measuring with
`CITYDIAG Q5 WRITES apply #N` before choosing a fix.

### 0e. readMainCardElements has no dedupe — NOT fixed, out of scope 2026-08-19

Measured live: **cards in DOM 60 vs assignment map 59**. `parseLoads()` keeps only the outermost
match (`loadParser.js:197`, `!allCards.some(b => b !== a && b.contains(a))`);
`readMainCardElements()` does not, so a card containing a nested `div[id]` with the same UUID is
collected twice. Assignment is unaffected (the second write is identical) but `cards.length`
overstates the working set, and `currentPageKey()` embeds that count — so a duplicate perturbs
page detection. ⚠ The 2026-08-19 deadhead reconcile is **deliberately keyed on the value element,
not the id**, precisely so that fixing or not fixing this cannot change what is rendered.

### 0a. ✅ FIXED 2026-08-19 — FILTER FEEDBACK LOOP (heading corrected 2026-08-24)

⚠ **This entry said "NOT fixed" until 2026-08-24 and was wrong.** Closed by the idempotent
deadhead substitution: a card already showing the right value is left completely untouched.
Original diagnosis kept below.

Selecting a city on a board with at least one multi-city load puts the extension into an unbounded
loop at roughly one iteration per animation frame:

    applyCityFilter -> restoreDeadheads/applyCityDeadheads -> insertBefore/removeChild
      -> board MutationObserver {childList:true, subtree:true} wakes
      -> onBoardRerender -> reapplyCityFilter -> applyCityFilter -> ...

Pre-existing since **869cfc2 (2026-08-15)**, not caused by the diagnostics. Invisible until now
because every log was taken with filter = ALL, where both ends of the loop are closed.

**Candidate fixes — Ihor's call, and it should be made from the CITYDIAG Q5/Q6 numbers:**
1. Suspend the observer around the filter apply (`disconnect()` / re-`observe()`).
2. Skip the apply when nothing would change — an idempotence check on the computed hidden set.
3. Move the deadhead substitution out of the apply path so the filter writes attributes only,
   restoring the original "cannot retrigger itself" premise.
4. Have `onBoardRerender` ignore mutations whose nodes carry `data-testid="ext-city-deadhead"`.

⚠ Also update `onBoardRerender`'s header comment: it still claims the filter cannot retrigger
itself because it "only writes style.display". The deadhead substitution made that false.

### 0b. `readMainCardElements()` has no dedupe — found 2026-08-18, NOT fixed

`parseLoads()` keeps only the outermost match (`loadParser.js:197`,
`!allCards.some(b => b !== a && b.contains(a))`). `readMainCardElements()` does not, so a card
containing a nested `div[id]` with the same UUID is collected twice. Harmless to assignment (the
second write is identical) but it makes `cards.length` overstate the working set, and
`currentPageKey()` embeds that count — so a duplicate perturbs page detection. It is also why
"61 collected, 60 in the map" looks like a lost card and is not one.

### 0c. `currentPageKey()` mixes two different populations — found 2026-08-18, NOT fixed

The key is `range | count | firstId | lastId`. The **range** counts `/search` results only; the
**count/first/last** cover the rendered list, which also holds `/recommendations` cards. So the
recommendations block re-rendering on its own flips the key and is read as a PAGE CHANGE, which
REPLACES the assignment map. Measured harmless today because the merged coords map re-derives
everything — but the signal is not measuring what its name claims.

### 0. ✅ FIXED 2026-08-19 — THE >50 DEGRADATION (heading corrected 2026-08-24)

⚠ **Stale heading, corrected.** The degradation was the filter feedback loop (0a); idempotence
closed it. No product decision was needed after all.

A load beyond `CITY_ASSIGN_MAX_MILES` (150) of every active chip is **unassigned**, therefore
**never hidden**, therefore **visible under every city tab** — and `publishUnassignedCount()`
publishes only `result.unresolved`, so `result.outOfRange` **never reaches the All badge**. The
dispatcher sees wrong-city loads with nothing on screen contradicting them. This is the same class
of failure the badge was built to prevent, in the one branch the badge does not cover.

It tracks board size because Amazon's own deadhead does: 0 loads over 150 mi on the small captures,
**21 of 50 on the 338-result one**. Our threshold is a fixed constant; Amazon's search radius is
Ihor's to set. Nothing reconciles them.

**Four candidate fixes, all needing Ihor's call — do not pick one unilaterally:**
1. Publish `outOfRange` on the badge too (honest, smallest, does not change what is shown).
2. Hide out-of-range loads instead of showing them (breaks "never hide what we could not place").
3. Raise `CITY_ASSIGN_MAX_MILES`, or derive it from the search radius.
4. Trust Amazon's `deadhead` for membership instead of our haversine.

Turn `CITY_ASSIGN_DEBUG` on and filter the console for `CITYDIAG` to read the whole chain.

### 1. Auto-open shows no panel — PLAN 29c
The manual click renders the panel; **auto-open does not**. Stage C is written but not started.
This is the most visible gap for a dispatcher: the loop opens the best new load and he still has
to click it to see our breakdown.

### 2. Night mode still zebra-stripes the panel
Light mode's alternating row fill was removed; `nightMode.js` holds a dark counterpart that
survives. **Blocked by the standing "do not edit nightMode.js" constraint** — one rule, removable
on Ihor's word.

### 3. The surge branch has no filter awareness
The new-load path partitions by the active city filter; the **price-surge path does not**. It can
still auto-open a card the filter has hidden. Deliberately left alone when filter-awareness was
added — decide separately.

### 4. Panel fields present in the payload but not shown — PLAN 29f
All measured and available: cost breakdown (Base Rate / Fuel Surcharge / Toll Charge),
`specialServices` (SWING_DOOR, SLIDE_TANDEMS, STRAPS, LUMPER), layover, equipment type, trailer
owner, per-stop instructions and weight, deadhead, arrival windows. Each needs a projection field
**and** a render slot.

### 5. The trailer id does not exist in this payload
`trailerDetails[].assetId`, `.assetType`, `.assetSource` and `.trailerLoadingStatus` are
**null in all 253 captured entries**. Only `.assetOwner` is populated, and it is a carrier code.
**Do not go looking for a trailer number again** — it is not sent.

### 6. Equipment label style — open question for Ihor
Amazon prints a compact `53' Trailer P`, where `P` is `PRELOADED`'s initial (established by
pairing a captured card against its response). We render the full word — `53' Trailer · Preloaded`
— because the letter is confirmed for PRELOADED only; LIVE and DROP have no captured card, and
inventing `L`/`D` would be a guess. **One line to switch to initials if he prefers the exact
match.**

### 7. `samples/` is gitignored
Every "measured from disk" fact in these docs depends on files a fresh clone will not have.
Worth deciding whether a redacted subset should be committed.

### 8. Testing gap, closed but worth remembering
**1220 checks were green while clicking a card did nothing** — Stage A removed the render call,
Stage B never restored it, and one green check asserted the absence. `wiring-suite` now
dispatches a real click and asserts a panel appears. **Prefer end-to-end wiring tests over more
unit assertions.**

---

## 🧭 POST-LAUNCH / UNSCHEDULED — Single-Tab Multi-Driver Monitor

**Status: concept defined, data verified, NOTHING BUILT.** Not scheduled before the Chrome Web
Store launch. Build after publication or alongside it, at Ihor's call. No task, no test case and
no stub file exists for this yet, deliberately.

### Problem
A dispatcher covering several drivers in different regions opens **one Relay tab per driver**,
each auto-refreshing. That multiplies requests from a single IP and trips Amazon's rate limit —
the same throttle already documented in this repo (see the cross-tab rate-limiting blocker below,
and `background.js`'s backoff).

### Approach
Use Amazon's own **multi-origin search**: one tab, up to **five origin cities in one query**, one
request cycle. Our layer splits the merged result list per driver and shows **sub-tabs** (one per
driver) with a **per-tab new-load counter**. A **colour stripe per driver** stays visible on the
combined "All" view.

### How the split works — settled by live capture, DO NOT REDESIGN

Captured 2026-08-05 from a real five-city search (LITTLE ROCK AR, CHICAGO IL, TULSA OK, HEBRON KY,
JACKSONVILLE FL; radius 25; 104 results).

1. **Amazon does NOT attribute a load to the origin city that matched it.** Every field containing
   `domicile` / `origin` / `search` / `query` / `filter` / `match` / `cluster` / `region` /
   `market` was checked; **none names a searched city**. Searching the response text for the
   searched city names is useless — the search is **radius-based**, so pickups come back as NORTH
   LITTLE ROCK, MATTESON, HARVEY, ROMEOVILLE, SKOKIE and similar, names that never appear in the
   filter.
2. **Assignment is therefore by DISTANCE.** The pickup's coordinates are present and populated on
   every work opportunity at:
   ```
   workOpportunities[].loads[0].stops[0].location.latitude
   workOpportunities[].loads[0].stops[0].location.longitude
   ```
   That stop carries `stopType: "PICKUP"` and `stopSequenceNumber: 1`. The searched cities'
   coordinates already come from the **cities endpoint we use for Post-a-Truck** (`name`,
   `stateCode`, `latitude`, `longitude` — see api-samples.md §2). Assign each load to the
   **nearest configured city**. Cost is trivial: ~5 comparisons per load.
3. **Do NOT match on city or state strings.** State formatting is inconsistent across records —
   the captures contain `"IL"` and `"Ohio"`, `"IN"` and `"Indiana"`, `"KY"` and `"KENTUCKY"`,
   `"FL"` and `"Florida"`. City names alone are not unique either.
4. **A single refresh fires MORE THAN ONE `/api/loadboard/search` call** when the dispatcher has
   several saved-search tabs open. In the 2026-08-05 capture two fired together: one with
   `totalResultsSize: 104` (the active tab) and one with `totalResultsSize: 11` and **`payout`
   null on every record** (a different tab). **A consumer must select the response whose
   `workOpportunities[].id` values match the load-card ids currently rendered — never simply the
   first response seen.**
5. **The DOM stays the source of truth for what is on screen.** Same narrow-hybrid decision
   already recorded for the detail panel (STATE.md → JSON reconnaissance).

### Known constraints
- Amazon caps **Origin at five cities** per search.
- **Radius is a single value applied to all origins**, so widely separated drivers share one
  radius. **Effect on usability is UNTESTED.**
- **Driver names are ours, not Amazon's** — the dispatcher assigns a name to each origin city in
  our UI.

### ⚠️ Provenance of the findings above — read before relying on them
Findings 1–4 come from Ihor's 2026-08-05 five-city capture, **which is not in `samples/`**. What
was independently verified against the captures that *are* on disk (`paired-search.json`, 50 work
opportunities):

| Finding | Verified here? |
|---|---|
| 1 — no origin-attribution field anywhere | **Yes.** Every candidate keyword walked across the whole document; the only hits were `searchAuditId` (one opaque UUID per response), `startLocation`/`endLocation`/`stops[].location.domicile` (the load's *own* facility, e.g. `"MDW"`), `matchDeviationDetails` (null throughout) and `searchChannelStampedDuration` (timing counters). None names a searched city. |
| 2 — coordinate path and population | **Yes.** `loads[0].stops[0].location.latitude/longitude` populated **50 of 50**; that stop is `stopType: "PICKUP"`, `stopSequenceNumber: 1`. Note the coordinates sit on the nested `location` object — `'latitude' in stops[0]` is **false**. |
| 3 — state-string inconsistency | **Partly.** `"IL"`/`"Ohio"`, `"IN"`/`"Indiana"` and `"KY"`/`"KENTUCKY"` were seen directly. **`"FL"`/`"Florida"` was not** — no Florida record exists in the on-disk captures. |
| 4 — two simultaneous searches, 104 + 11 with null payout | **No.** Not reproducible from the on-disk captures; recorded as reported. |
| 5 — DOM stays authoritative | Pre-existing recorded decision, unchanged. |

**Before building, capture the five-city response into `samples/` and re-confirm findings 1, 3
and 4 against it.** Finding 4 in particular is the one most likely to cause a subtle wrong-data
bug, and it is currently the least verified. Note `samples/` is gitignored (see STATE.md).

---

## ✅ RESOLVED 2026-07-31 (later) — Inline panel colour: moved to the correct element

**Status: DONE in code, pending a visual pass (TC-PANEL-COLOUR-2).** The dispatcher confirmed the
intended surface was the segment **header**. `#F5F5F5` moved from `.ext-seg-body` to
`--ext-leg-header-bg` (`utils/designTokens.js:48`, sole consumer `.ext-seg-header`), and
`.ext-seg-body` was restored to `#FFFFFF`. Both contrast regressions listed below were **fixed by
the move**: header secondary text `#4A6570` 4.48 → 5.69, stop address `#6B7280` 4.43 → 4.83.
Zebra returned to its original 1.073:1. **New item to eyeball:** the header/body seam is now
1.090:1 and may not read as a distinct band — TC-PANEL-COLOUR-2 step 3. Detail in CHANGELOG.md.

*The original blocked entry is kept below for the record of how it was diagnosed.*

### Original entry (superseded)

**Status: NOT done. Do not treat the CHANGELOG entry as a completed change.**

`#F5F5F5` was applied to **`.ext-seg-body`** (`content/inlinePanel.js`, `injectPanelStyle()`,
was `#FFFFFF`). **The dispatcher reports the colour he wanted did not change**, so the target
element is almost certainly wrong. The change is still in the tree.

**Why it probably isn't visible — leading hypothesis, unverified:** `.ext-seg-body` is
`display:none` until its leg is expanded (`.ext-open`). With the accordion collapsed the visible
surface is `.ext-seg-header` (currently `#CFDBFB`), not the body. So either the dispatcher was
looking at collapsed legs, or "load rows" means something else entirely — most likely the table
cells `.ext-inline-panel__table td`, which carry **no** background of their own today (only even
rows are tinted `var(--ext-n100)`).

**To unblock:** a screenshot with the intended element circled, or the element's class from
DevTools → Inspect. Candidates, in order of likelihood:
1. `.ext-inline-panel__table td` — the actual stop rows
2. `.ext-seg-header` — if "load rows" means the collapsed accordion rows
3. `.ext-inline-panel` — the whole panel surface

**Two measured side effects of the change as applied** (both computed to WCAG 2.1 from the real
source colours, both would need revisiting wherever the colour finally lands):
- **Zebra striping is now ~invisible.** Even rows are `var(--ext-n100)` = `#f5f7fa` against
  `#F5F5F5` — a separation of **1.016:1** (was 1.073:1 on white).
- **Stop-address contrast fell below AA.** `.ext-stop-addr` `#6B7280` measures **4.43:1**
  against `#F5F5F5`, under the 4.5:1 bar for 13px text (was 4.83:1 on white). On even rows it
  lands exactly on 4.50:1. One-line fix if wanted: `#6B7280` → `#6A7280` or darker at
  `inlinePanel.js:282`. Station codes (`#111827`, 16.27:1) are unaffected.

---

## ⛔ BLOCKED 2026-07-31 — Post-a-Truck cannot post R-type (own-trailer) loads

Amazon distinguishes **P** (Amazon-**P**rovided trailer) from **R** (carrier's own / **R**ented)
across roughly **24 equipment types**. We support **4**, and **all of them are the provided
variant**.

**The hard block, `content/patApi.js:400-401`:**

```js
visibleProvidedTrailerType:  'AMAZON_PROVIDED',
providedTrailerType:         'AMAZON_PROVIDED',
```

Both are hardcoded string literals in the upsert payload. Any post we create is therefore an
Amazon-provided-trailer post, whatever the dispatcher actually drives. There is no UI for it and
no branch in the payload builder.

**To unblock:** a captured **own-trailer** upsert payload — same procedure as the existing
captures in `docs/api-samples.md` (DevTools → Network → the `orders/upsert` POST → Copy request
payload), created by posting an R-type truck manually on the live board. We need to see what
`providedTrailerType` / `visibleProvidedTrailerType` become, and whether the `equipmentTypes`
enum changes shape for R variants (e.g. a separate enum vs a flag).

**Do not guess these values.** `docs/api-samples.md` already records that equipment enums differ
in non-obvious ways between what the cities API returns and what upsert expects; inventing an
R-type enum risks posting a wrong truck to a live marketplace.

Scope once unblocked: extend the equipment map, add a P/R selector to the PAT modal, branch the
two payload fields. Not started.

---

## ✅ RESOLVED 2026-08-05 — Collapse Amazon's left filters panel on auto-refresh START

**Status: IMPLEMENTED, pending a browser pass (TC-FILTERS-1).** Blocked across four separate
requests on "how do I read the panel's state?" — and the answer turned out to be **you don't**.

**What unblocked it:** a live capture on 2026-08-05 showing that Amazon **removes
`div.filters__column` from the DOM** when the panel is collapsed. Presence *is* the state, so
`collapseFilterPanel()` in `content/panelCloser.js` checks for that one element and clicks the
Filter button **only when the panel is confirmed open** — exactly one click, no verification
pass, and nothing at all happens when it is already collapsed.

**Superseded first attempt (same day), for the record:** the initial implementation could not
read the state, so it clicked, measured a load card's `getBoundingClientRect().left` before and
after with a 20px dead band, and clicked a **second time to revert** when it detected it had
opened an already-collapsed panel. Self-correcting but visually wrong — the panel flashed open
and shut on every START with filters already collapsed. Deleted the same day; **do not
reintroduce layout measurement on this path.**

`CLOSE_FILTER_PANEL` restored to `ALLOWED_CLICK_INTENTS` (`utils/constants.js`) and its click-site
section restored to `docs/SAFETY.md` as **Click 4** (Fast Book renumbered to Click 5). Detail in
CHANGELOG.md 2026-08-05; selector and the no-state finding in AMAZON_SELECTORS.md.

*The original blocked entry is kept below as the record of how it was diagnosed — including the
selector correction that explains why the three June attempts failed.*

### Original entry (superseded)

## ⛔ BLOCKED 2026-07-31 — Collapse Amazon's left filters panel on auto-refresh START

Requested 2026-07-31. **Nothing implemented** — blocked on one missing piece of evidence, by the
task's own instruction to stop rather than guess.

**Requirement:** on every press of the auto-refresh START control (not just page load), collapse
Amazon's left filters panel. Never reopen it automatically — not on stop, pause, or resume.

**This was built and removed once before.** CHANGELOG 2026-06-18 "Remove filter-panel
auto-close": three strategies tried (close-button search, toggle-button click, Escape dispatch +
retry), none reliable. `content/panelCloser.js:72` still says *"Left filter panel is intentionally
left alone."* `CLOSE_FILTER_PANEL` was also removed from `ALLOWED_CLICK_INTENTS`
(`utils/constants.js`) and its SAFETY.md click-site section deleted — **re-adding this feature
means re-authorising a click site**, not just writing the selector.

**SOLVED — why all three attempts failed.** They all used `button[aria-label="Filter"]`. The
2026-07-31 capture shows the `aria-label` is on an inner span, not the button:

```html
<button type="button" class="css-14evw8c">…<span aria-label="Filter" role="img">…
```

so that selector matched nothing. The working form (no dependence on the generated
`css-14evw8c` hash, which will change on Amazon's next deploy):

```js
// ⚠ SUPERSEDED — see the correction below. Exact-match fails on the real label.
document.querySelector('[aria-label="Filter"][role="img"]')?.closest('button')
```

**CORRECTION 2026-07-31 — the label has TRAILING SPACES.** A second capture shows
`aria-label="Filter  "`, not `"Filter"`. CSS attribute selectors are exact by default, so the
selector above matches **nothing** either — same failure mode as the three 2026-06-18 attempts,
one layer along. Any exact-equality match on this label is wrong. Use a trimmed / starts-with
comparison:

```js
// starts-with selector, then confirm by trimming — tolerant of trailing (or added) whitespace
// and of Amazon appending a count/suffix later. Still no dependence on the css-14evw8c hash.
var icon = Array.prototype.find.call(
  document.querySelectorAll('[role="img"][aria-label]'),
  function (el) { return el.getAttribute('aria-label').trim() === 'Filter'; }
);
var filterBtn = icon && icon.closest('button');
```

**STILL BLOCKED — how to tell whether the panel is already open.** The control is a toggle, so
clicking it while already collapsed would OPEN it: the opposite of the requirement. The capture
is truncated (`…`) exactly where the button's own attributes would appear, and the 2026-06-18
notes explicitly say Amazon *"may not put `aria-expanded` on the button at all"*. No captured
markup of this panel exists anywhere in the repo.

> ### THE ONE FACT THAT UNBLOCKS THIS
> **When the filters panel is collapsed, is it removed from the DOM, or merely hidden?**
>
> Either answer is enough. If it is **removed**, presence/absence of the panel node is itself a
> reliable state test and no attribute is needed. If it is **hidden**, we need whichever
> attribute differs between the two states — `aria-expanded`, `aria-pressed`, `aria-controls`,
> a `data-*` flag, or a computed `display`/`width`.
>
> This was requested four times across the 2026-07-31 session and never supplied. The task was
> re-issued with new markup each time (most recently revealing the `aria-label` has trailing
> spaces, `"Filter  "`), but the state question was never answered, so it stayed blocked
> throughout. **Do not implement without it** — a blind click opens the panel, which is the
> exact failure the requirement calls out.

### To unblock: paste this in DevTools on the load board, once with the panel OPEN and once with it COLLAPSED

```js
(() => {
  const icon = document.querySelector('[aria-label="Filter"][role="img"]');
  const btn  = icon && icon.closest('button');
  if (!btn) return console.log('NO BUTTON FOUND — capture the Filter control markup by hand');
  const attrs = (el) => [...el.attributes].map(a => `${a.name}="${a.value}"`).join(' ');
  console.log('BUTTON  :', attrs(btn));
  console.log('PARENT  :', btn.parentElement && attrs(btn.parentElement));
  console.log('ICON    :', attrs(icon));
  const controlled = btn.getAttribute('aria-controls');
  console.log('aria-controls ->', controlled,
    controlled && document.getElementById(controlled)
      ? document.getElementById(controlled).outerHTML.slice(0, 300) : '(no element)');
  console.log('ANY aria-expanded on page:',
    [...document.querySelectorAll('[aria-expanded]')]
      .map(e => `${e.tagName}[aria-expanded=${e.getAttribute('aria-expanded')}] label=${e.getAttribute('aria-label')}`));
  console.log('BUTTON RECT:', JSON.stringify(btn.getBoundingClientRect()));
})();
```

Also useful, same two states: right-click the filters panel itself → Inspect → copy the
**outerHTML of the panel's outermost container, first ~300 chars**, plus its computed `width`
and `display`. If the panel is removed from the DOM when collapsed rather than hidden, say so —
that alone is a reliable state test and unblocks this immediately.

**What I need from that capture:** any attribute that differs between the two states — on the
button, its parent, or the panel container. `aria-expanded` / `aria-pressed` / `aria-controls` /
a `data-*` flag / presence-vs-absence of the panel node / a measurable width change. Any one of
them is enough.

**Then the implementation is small:** a `collapseFilterPanel()` in `panelCloser.js` called from
`closePanelsForStart()` (already invoked once per loop start from content.js's `tabState`
'running' subscriber, `val=true` only — so "every start press, never on stop/pause/resume" comes
free), guarded by `isForbiddenElement()`, wrapped so it can never throw or block the start, and a
re-added `CLOSE_FILTER_PANEL` intent plus its SAFETY.md section.

---

## ↩️ REMOVED 2026-07-31 — Sidebar paused/rate-limit message (reinstatement record)

Removed by PM decision. **Message only — the backoff/pause behaviour was NOT touched** and is
still fully live: the extension still stops polling on 429/503, still waits, still resumes
automatically. `background.js` and `content/networkObserver.js` were not edited at all. All
changes were in `content/sidebar.js`.

This section exists so the message can be put back without re-deriving it. Everything below is
verbatim from `HEAD:content/sidebar.js` at the time of removal (commit `9cd7e7d` + working tree).

### What the dispatcher saw

An amber (`#d4a72c`) line in sidebar row 1, replacing the speed slider while paused:

> Paused — Amazon has temporarily limited your IP due to frequent refreshes. Access returns on
> its own; the extension will resume automatically.

with a trailing circled "i" opening a 340px tooltip.

### Elements and testids removed

| testid | Tag | Role in the message |
|---|---|---|
| `ext-rate-limit-banner` | `span` | Flex container, `role="status"`, `style.display='none'` by default. Parent of the two below. |
| `ext-rate-limit-text` | `span` | The sentence itself, ellipsised when cramped. |
| `ext-rate-limit-info` | `span` | Trailing "i", `tabindex="0"`, `aria-label="About this pause"`. **Existed only to accompany this message.** |
| `ext-rate-limit-tooltip` | `div` | `role="tooltip"`, child of the "i". The long explanation. |

### Construction code (was directly above the memory indicator, ~line 263)

```js
  const rateLimitBanner = document.createElement('span');
  rateLimitBanner.setAttribute('data-testid', 'ext-rate-limit-banner');
  rateLimitBanner.setAttribute('role', 'status');
  rateLimitBanner.style.display = 'none';

  const rateLimitText = document.createElement('span');
  rateLimitText.setAttribute('data-testid', 'ext-rate-limit-text');
  rateLimitText.textContent =
    'Paused — Amazon has temporarily limited your IP due to frequent refreshes. ' +
    'Access returns on its own; the extension will resume automatically.';

  const rateLimitInfo = document.createElement('span');
  rateLimitInfo.setAttribute('data-testid', 'ext-rate-limit-info');
  rateLimitInfo.setAttribute('tabindex', '0');
  rateLimitInfo.setAttribute('aria-label', 'About this pause');
  rateLimitInfo.textContent = 'i';

  const rateLimitTooltip = document.createElement('div');
  rateLimitTooltip.setAttribute('data-testid', 'ext-rate-limit-tooltip');
  rateLimitTooltip.setAttribute('role', 'tooltip');
  rateLimitTooltip.textContent =
    'Amazon limits how often the load board can be refreshed from a single IP address. ' +
    'When the limit is hit, the whole site stops loading for a while — this is not an ' +
    'account issue and nothing is wrong with your extension. It clears by itself. To ' +
    'avoid it, turn on Shared refresh limit in the extension settings: it spreads one ' +
    'refresh budget across all your open tabs instead of each tab refreshing on its own.';
  rateLimitInfo.appendChild(rateLimitTooltip);

  rateLimitBanner.appendChild(rateLimitText);
  rateLimitBanner.appendChild(rateLimitInfo);
```

**DOM insertion** — one line in the row-1 build block, between `sliderValue` and
`memoryIndicator`; order matters, the banner sat where the slider had been:

```js
  row1.appendChild(rateLimitBanner);
```

### CSS removed (all inside the `style.textContent` string)

Two banner-only rules, which sat between `[data-testid="ext-slider-value"]` and
`[data-testid="ext-memory-indicator"]`:

```js
    '#ext-sidebar [data-testid="ext-rate-limit-banner"]{' +
      'flex:1;min-width:0;display:flex;align-items:center;gap:6px;' +
      'font-size:12px;font-weight:600;color:#d4a72c;' +
    '}' +
    '#ext-sidebar [data-testid="ext-rate-limit-text"]{' +
      'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    '}' +
```

One rate-limit-only rule (the "i" inherits the banner's amber instead of the neutral chip fill,
which is also why it needed no `html.ext-night` override):

```js
    '#ext-sidebar [data-testid="ext-rate-limit-info"]{' +
      'background:transparent;border-color:currentColor;color:currentColor;' +
    '}' +
```

One tooltip-width rule (wider than the 220px memory tooltip because the text is ~4x longer):

```js
    '#ext-sidebar [data-testid="ext-rate-limit-tooltip"]{' +
      'width:340px;' +
    '}' +
```

**Four SHARED selectors were narrowed, not deleted** — each dropped its rate-limit half and kept
the memory half unchanged. To reinstate, add the second selector line back to each:

| Rule | Add back |
|---|---|
| info icon geometry | `'#ext-sidebar [data-testid="ext-rate-limit-info"]{' +` after the `ext-memory-info,` line |
| info icon `:focus-visible` | `'#ext-sidebar [data-testid="ext-rate-limit-info"]:focus-visible{' +` |
| tooltip base (`display:none;position:absolute;top:32px;right:0;width:220px;…`) | `'#ext-sidebar [data-testid="ext-rate-limit-tooltip"]{' +` |
| tooltip `.ext-tooltip-visible` | `'#ext-sidebar [data-testid="ext-rate-limit-tooltip"].ext-tooltip-visible{' +` |
| night-theme tooltip (`html.ext-night …`) | `'html.ext-night #ext-sidebar [data-testid="ext-rate-limit-tooltip"]{' +` |

**Kept deliberately:** `#ext-sidebar{max-width:calc(100vw - 16px)}` was added *for* this banner
but is retained — it is what bounds row 2's width so its ellipsis can trigger. No action needed
on reinstatement.

### Call sites that set/showed the text

`updateRateLimitDisplay()` — the whole paused branch. Original body:

```js
  function updateRateLimitDisplay() {
    var paused = isRateLimitPaused();
    rateLimitBanner.style.display = paused ? '' : 'none';
    slider.style.display          = paused ? 'none' : '';
    sliderValue.style.display     = paused ? 'none' : '';
    if (!paused) hideRateLimitTooltip(); // never leave a tooltip orphaned on a hidden banner
    renderModeLabel();
    renderSharedRateStatus();
  }
```

Current body is just the last two lines. **Note the slider swap** (`slider`/`sliderValue` hidden
while paused): that existed only to make room for the banner and was removed with it, so the
speed control now stays visible in every state. Reinstating the banner means restoring those
three lines too, or the banner will render *alongside* the slider rather than in place of it.

Two tooltip helpers, removed entirely (they sat right after `hideMemoryTooltip`):

```js
  function showRateLimitTooltip() {
    rateLimitTooltip.classList.add('ext-tooltip-visible');
  }

  function hideRateLimitTooltip() {
    rateLimitTooltip.classList.remove('ext-tooltip-visible');
  }
```

Five listeners, removed entirely (they sat after the `memoryInfo` listeners, at the end of
`buildSidebar`):

```js
  rateLimitInfo.addEventListener('mouseenter', showRateLimitTooltip);
  rateLimitInfo.addEventListener('mouseleave', hideRateLimitTooltip);
  rateLimitInfo.addEventListener('focus', showRateLimitTooltip);
  rateLimitInfo.addEventListener('blur', hideRateLimitTooltip);
  rateLimitInfo.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (rateLimitTooltip.classList.contains('ext-tooltip-visible')) {
      hideRateLimitTooltip();
    } else {
      showRateLimitTooltip();
    }
  });
```

### The state that drove it — ALL STILL PRESENT, nothing to restore

The message was purely a reader of state that still exists and still works:

- `background.js` `reportResult()` sets `state.rateLimited = true` on any reported failure and
  clears it on a reported success, writing `RATE_LIMITER_KEY` (`extRateLimiterState`).
- `content/sidebar.js` `_rateLimitState` (local cache), `adoptRateLimitState()`,
  `isRateLimitPaused()` — all untouched and still live.
- The `chrome.storage.onChanged` handler for `RATE_LIMITER_KEY` still fires and still calls
  `updateRateLimitDisplay()`.

`isRateLimitPaused()` still has one consumer: `renderSharedRateStatus()` hides row 2 (the
"Active tabs: N" line) while paused. That condition was **left as-is** — it belongs to a
different element and the task was scoped to the message. Visible effect while paused: row 2
disappears and the bar is 20px shorter, with no text anywhere explaining why.

**To reinstate:** put back the four elements, the `row1.appendChild`, the two banner CSS rules +
the info/tooltip-width rules, re-widen the five shared selectors, restore the three swap lines in
`updateRateLimitDisplay()`, the two tooltip helpers, and the five listeners. No changes needed in
`background.js`, `networkObserver.js`, `content.js`, or `utils/storage.js`.

**Related question — ✅ RESOLVED 2026-07-31, same day.** The paused state used to be entered by
*any* failed or aborted `/api/loadboard/search` request. Fixed: aborts are no longer reported at
all (`content/networkObserver.js`), and only HTTP 429/503 enter backoff (`background.js`
`RATE_LIMIT_STATUSES`). See CHANGELOG.md 2026-07-31 and TC-RATELIMIT-7. **If the banner is
reinstated it will now only appear for genuine rate limiting** — which is what makes reinstating
it viable at all; before this fix it fired during ordinary saved-search switching.

---

## 🚫 PRE-LAUNCH BLOCKER — Cross-tab rate limiting (implemented, unverified in a real browser)

**Confirmed with real data, 2026-07-20:** 3-4 Relay tabs open, each with its own independent
2s refresh timer, produced sustained HTTP 503 from Amazon on `/api/loadboard/search` across
ALL tabs. Switching networks restored access immediately — IP-based throttle, not
account-based. Root cause: the refresh interval was per-tab, so N tabs multiplied the
effective request rate against one IP. **Do not ship/distribute this extension to more than
one dispatcher (or recommend multi-tab use) until this is verified live**, since the failure
mode is "the extension appears to silently break for everyone sharing that IP," not a
contained per-tab issue.

**Code-complete** — `background.js` (new service worker, permit dispenser + backoff state
machine), `content/networkObserver.js` (new, MAIN-world 503 detection), global refresh
interval (was per-tab), and a paused banner in every tab's sidebar (originally a "Retrying in
Xs" countdown; **the countdown was removed 2026-07-30** — that number was our own backoff
timer, not Amazon's unblock time, so it was replaced with static copy plus an "i" explainer
tooltip, and the banner now clears only on an observed success rather than on timer expiry.
See CHANGELOG.md 2026-07-30 and TEST_CASES.md TC-RATELIMIT-5). See CHANGELOG.md 2026-07-20
for full detail — including 18/18 real
functional tests on the core permit/backoff algorithm (pure logic, no DOM needed) and 4/4
on the content-script integration.

**Blocking this from being considered launch-ready — none of the following has been
checked in an actual multi-tab browser session (no browser available in the environment
that implemented this):**
- [ ] Open 4 real tabs, confirm the AGGREGATE request rate across all four matches the
      global interval (not 4x it).
- [ ] Force/simulate a real 503 and confirm all tabs pause and count down together, in
      sync, and all resume together.
- [ ] Confirm the countdown survives a popup reopen and a tab reload (persistence).
- [ ] Confirm the `"world":"MAIN"` network observer actually intercepts real Amazon page
      traffic in the dispatcher's actual Chrome version (Chrome 111+ feature; declarative
      main-world content-script injection has not been used anywhere else in this
      codebase before now).
- [ ] Confirm real service-worker eviction/restart behavior over an actual multi-minute
      backoff window doesn't lose or corrupt the shared state.

See docs/TEST_CASES.md TC-RATELIMIT-1 for the full manual test script.

---

## Step 3 — Wire popup controls (next up)

Wire each popup control to `chrome.storage.local` one at a time. Order TBD by PM.

### Night Mode ✅ DONE
CSS-class-toggle approach: `html.ext-night` class toggled by `content/nightMode.js`. Popup checkbox wired in `popup/popup.js`. Storage key: `STORAGE_KEYS.NIGHT_MODE = 'nightMode'`.

### Tab Alert ✅ DONE
`content/tabAlert.js` calls `flashTabAlert()` (async, reads `STORAGE_KEYS.TAB_ALERT`). Blinking title ("🔔 " prefix, 750 ms interval) + orange favicon ("!") for 10 s. Clears on `visibilitychange` (user focuses tab). Called from content.js after `playAlert()`. Popup checkbox wired in `popup/popup.js`. Storage key: `STORAGE_KEYS.TAB_ALERT = 'tabAlert'`.

### Sound block ✅ DONE
Volume slider (`popup-volume`) wired, persists as `soundVolume` (0–100, default 70). Sound selector (`popup-sound-select`) wired, persists as `soundId` (default `'default'`). 25 distinct sounds in `content/soundAlert.js` SOUND_DEFS dispatch table. Preview plays on dropdown change and replay button click. `SOUND_MUTED` fully removed. Both volume and soundId survive popup close/reopen.

### Price Surge Alert ✅ DONE
`content/priceSurge.js` — `checkPriceSurge(loads)` called every tick. Builds `newHistory` from scratch per tick (auto-purges gone loads). Triggers on payout increase >= threshold; applies `.ext-surge-price` green tint + `↑ +$NN` badge; calls `playAlert()`. Popup controls: `popup-surge` → global `surgeEnabled`; `popup-surge-threshold` → global default for new tabs. **Per-tab isolation ✅ (2026-06-18):** threshold and priceHistory moved to `tabState` (sessionStorage-backed). Only `SURGE_ENABLED` remains in chrome.storage.local. Sidebar `sidebar-surge-threshold` field overrides per-tab.

### Hide tag filters ✅ DONE
Four compact toggles side-by-side in popup (`.popup-tag-block`): Promoted / Starting soon / Trailer ready / Booked before. Each hides the matching tag **badge only** via `display:none` on the respective `[id="..."]` element — space collapses (no leftover gap). If ALL known tag children of a `.wo-tag` wrapper are hidden, the wrapper itself is also set to `display:none`. Load card stays fully visible and participates in new-load detection. `MutationObserver` active only while ≥1 toggle is on. Storage keys: `hidePromoted`, `hideStartingSoon`, `hideTrailerReady`, `hidePastBook` (all boolean, default false).

### Auto-Open Top Load ✅ DONE (2026-07-03)
`popup-auto-open` checkbox in popup (under Tab Alert row). Key: `STORAGE_KEYS.AUTO_OPEN = 'autoOpenTopNew'`. True-default: `checked = data[KEY] !== false`. When OFF: loop still detects + highlights + sounds + auto-stops, but `openTopNewLoad` is not called and no inline panel renders. Reset restores to ON.

### Hide Similar Matches ✅ DONE
Toggle (`popup-hide-similar`). On enable: find the second `div.load-list` (the "Similar matches" block) and hide its parent container via `display:none`. The parser already ignores it (first `div.load-list` only), so this is purely visual decluttering.
- Storage key: `STORAGE_KEYS.HIDE_SIMILAR = 'hideSimilarMatches'` (boolean)

### Reset to Defaults ✅ DONE (2026-06-30)
Button (`popup-reset`). Clears all extension-managed keys (`Object.values(STORAGE_KEYS)`)
from `chrome.storage.local`; resets popup UI controls to documented defaults. Does not
touch Amazon keys (chrome.storage.local is extension-sandboxed) or `tabState`. Restyled
as a muted text link, bottom-left of popup. See CHANGELOG.md 2026-06-30.

---

## Instant detection via MutationObserver ✅ DONE (2026-06-18)

`content/loadObserver.js` — `MutationObserver` on `div.load-list` with debounce (200ms).
Runs the full detection pipeline instantly when Amazon's DOM changes (new loads pushed,
filter params changed). Supplements timer tick; self-trigger prevention via
`isExtManagedNode()`. Wired through `tabState 'running'` subscriber.

---

## Step 3 — Memory-leak / caching audit (PLANNED, do alongside popup wiring)

Tab RAM grows over long sessions. Audit targets:

1. **`_element` DOM references in `knownLoadIds`** — ✅ DIAGNOSED 2026-06-30, **NON-ISSUE, CLOSED.** `knownLoadIds` is a `Set<string>` (UUID strings only). `detectNewLoads()` calls `knownLoadIds.add(load.loadId)` — the string ID only, never the load object. `_element` references are local to each tick's `validLoads` / `newLoads` arrays and go out of scope when the tick function returns; GC can collect them freely. Secondary observation: the Set grows unboundedly (no eviction of gone loads), but at ~36 bytes/UUID it is negligible in practice.
2. **Price-history store** ✅ RESOLVED — `checkPriceSurge` rebuilds `newHistory` from scratch each tick; entries for gone loads are never written, so storage stays bounded.
3. **Style/favicon injection idempotency** — all injected `<style>` tags are already guarded by `id` check. Favicon swap must also be idempotent.
4. **Scanline** — CSS-only animation, no JS loop. Confirmed safe.
5. **`chrome.storage.onChanged` listeners** — ✅ RUNNING and SPEED removed from onChanged (now tabState pub/sub). Remaining listeners: nightMode, tabAlert, hideSimilar, tag filters, sound (all global). Confirm no re-registration on SPA navigation.

---

## Manual memory indicator ✅ DONE (2026-06-30)

Replaced the automatic memory-watchdog reload with a dispatcher-controlled indicator.
`content/sidebar.js`: `ext-memory-indicator` (color-interpolated dot, polled every 7s via
`getHeapUsageRatio()` in content.js) + `ext-memory-info` (hover/tap tooltip). Click →
`location.reload()` directly, dispatcher-initiated only. See CHANGELOG.md 2026-06-30 and
SAFETY.md "Extension-owned click" for full detail.

### Auto-restore Amazon filters after reload (PLANNED, not started)
Explicitly out of scope for the manual-indicator work above. Amazon Relay's search filters
(Origin, Radius, Payout min, Equipment) live only in React state, not the URL, so they are
lost on every reload — manual or (formerly) automatic. Restoring them would require reading
the dispatcher's current filter values from Amazon's filter-panel DOM before reload, saving
them, and re-applying them by simulating input/clicks on Amazon's own filter controls after
reload — that DOM interaction needs its own SAFETY.md review before any implementation
starts (new click/input sites on Amazon's page, currently zero such sites exist for filters).

---

## LoadUnit — unified per-load data model ✅ DONE (Steps 1–3, 2026-06-30)

`utils/loadStore.js` — in-memory per-tab store, not sessionStorage-backed. Functions:
`mergeLoadUnit`, `getLoadUnit`, `pruneLoadUnits`, `getAllLoadUnits`. Loaded in manifest
immediately after `tabState.js`. Phase 1 (board fields) wired in `loadParser.js` every
tick. Phase 2 (detail struct) wired in `inlinePanel.js / showInlinePanel()`. Return
values and external behavior of both caller sites unchanged. `window.__EXT_DEBUG.getLoadUnits`
exposed for console inspection.

**Step 4 — priceSurge.js migration (DEFERRED)**
Migrating `tabState.priceHistory` into LoadUnit (`payoutPrev` field per entry) was
explicitly deferred. `checkPriceSurge` and `tabState.priceHistory` are unchanged.

**searchContext (NOT YET PARSED)**
`searchContext: null` in every LoadUnit. Requires new Amazon filter-panel selector work
before implementation. Schema slot is reserved.

---

## Popup / sidebar / sound fix pass ✅ DONE (2026-07-03)

Six fixes across `popup/`, `content/sidebar.js`, `content/priceSurge.js`, `utils/constants.js`, `utils/storage.js`. New file: `utils/soundDefs.js`. See CHANGELOG.md 2026-07-03 for full detail.

1. **Auto-Open popup toggle** — `popup-auto-open` checkbox wired. True-default.
2. **Shared sound definitions** — `utils/soundDefs.js` global extracted; `POPUP_SOUND_DEFS` and `SOUND_DEFS` locals deleted from popup.js and soundAlert.js respectively. Popup preview and in-page alert now provably identical.
3. **toggleRunning tabState fix** — reads `tabState.get('running')` instead of stale DOM attribute.
4. **Logger discipline** — 3 `console.log` calls in popup.js replaced with `logger.log`.
5. **priceSurge null-parent guard** — `if (badge.parentNode)` before `removeChild`.
6. **Log noise + hardening** — `updateMemoryIndicator` demoted to `logger.debug`; `isForbiddenElement` guards non-Element nodes; SPEED/RUNNING/PRICE_HISTORY annotated legacy.

---

## detailOpener / loadParser / panelCloser / refreshManager fix pass ✅ DONE (2026-07-03)

Five fixes in the click and parse pipeline. See CHANGELOG.md 2026-07-03 for full detail.

1. **Highest-paying auto-open** (`sortByPayoutDesc` in content.js + runDetectionPipeline) — SPEC.md gap now closed: the extension now opens the highest-payout new load, not the first in DOM order.
2. **Detach guard in 250ms scroll-settle** (detailOpener.js) — prevents viewport-corner click when React unmounts the card mid-settle.
3. **Nested duplicate card filter** (loadParser.js) — `.wo-card-header--highlighted` inner headers no longer produce null-loadId duplicate parses.
4. **panelCloser Strategy 2 tightened** — prefers the top-area icon button; logs candidate index for diagnosability.
5. **Stale "ONE allowed click" comments** replaced with canonical SAFETY.md references.

---

## Core loop bug-fix pass ✅ DONE (2026-07-03)

Seven hardening fixes in `utils/tabState.js`, `content/content.js`, `content/loadObserver.js`, `content/loadParser.js`. No new click sites. See CHANGELOG.md 2026-07-03 for full detail.

1. **tabState.set no-op on unchanged value** — skips sessionStorage write + subscriber notify when value is already current (except `priceHistory`).
2. **Double-loop race guard** (`orchLoopActive` flag) — a second `running=true` during an in-flight tick cannot start a parallel loop chain.
3. **Shared detection pipeline** (`runDetectionPipeline`) — deduplicated the verbatim detect→highlight→sound→tabAlert→auto-open→auto-stop block from `orchestratorTick` and `runObserverPipeline` into one function.
4. **Observer re-arm on tick overlap** — instead of silently dropping mutations that arrive while `orchTickRunning`, re-arms up to 3× (with `MAX_REARMS` cap).
5. **Prune guard on transient empty parse** — `pruneLoadUnits` is skipped when `parseLoads()` returns 0 results (React remount transient).
6. **isExtManagedNode inner-container fix** — `node.closest('#ext-inline-panel, #ext-sidebar')` catches icon-swap child nodes inside our containers.
7. **Heap log noise** — `getHeapUsageRatio()` entry demoted from `logger.log` to `logger.debug`.

---

## Stage 14 — PAT Helper ✅ DONE (reworked 2026-07-07)
`ext-action-post` wired. Click → `openPostModal(loadId)` → extension-owned modal (580px, full form, LoadFetcher parity). Modal pre-fills from `loadStore`: origin/dest from `boardStops` (API-resolved), radii, time steppers (±15 min), stop count, min/max miles, $/mi+payout (linked via board distance), stem time, swing-door checkbox. Equipment gate: "53' Trailer" only (v1). Dispatcher reviews/edits, clicks Confirm → `buildPatPayload()` + `submitOrder()` POSTs to `/api/loadboard/orders/upsert` (same-origin, no new permissions). No `.click()` on Amazon DOM. `PAT_TEST_MARKUP_USD = 5000` silent safety markup. API paths confirmed from live captures. See AMAZON_SELECTORS.md + SAFETY.md "Network write" section.

**26' Truck / other equipment (PLANNED — waiting for live capture)**
`patModal.js` shows an unsupported notice for any equipment other than "53' Trailer". To add a new type: capture a live PAT upsert for that equipment type via DevTools Network, identify the correct `equipmentTypes` enum values, add a branch to `patApi.js` with a separate equipment list, remove the equipment gate for that type. Do NOT guess enum values.

---

## Card Action Bar ✅ PARTIAL DONE (2026-06-30)

Three icon-only buttons at the bottom of the expanded inline panel. Bar and all icons render.

| Button | Status |
|--------|--------|
| Copy Screenshot (`ext-action-camera`) | **✅ Wired (2026-06-30)**: click → `html2canvas(cardElement)` → PNG blob → `navigator.clipboard.write()`. Success: green checkmark flash 1.1 s. `vendor/html2canvas.min.js` v1.4.1 vendored; `clipboardWrite` permission in manifest. |
| Route Map (`ext-action-map`) | **✅ Wired (2026-06-30)**: click → `openRouteInMaps(data)` → Google Maps Directions URL (origin/waypoints/destination from deduplicated `data.segments` stops), `window.open` new tab. |
| Create Post (`ext-action-post`) | **Render-only placeholder.** Icon renders and hovers. No modal, no click handler. Wire when PAT Helper (Stage 14) or Create Post spec is defined. |

---

## Popup login (Supabase email OTP) ✅ DONE, live (2026-07-17)

Three-step email-OTP login in the popup's new "Account" section. See CHANGELOG.md and
UI_ELEMENTS.md 2026-07-17 for full detail. `vendor/supabase.min.js` vendored;
`utils/supabaseConfig.js` holds real project credentials (gitignored — see
`utils/supabaseConfig.example.js` for the template new setups should copy from). Still not
manually smoke-tested in a loaded-unpacked Chrome session — see STATE.md "Що далі".

### Login gating of features ✅ DONE (2026-07-20)
Every feature now requires an active Supabase session — hard block, not a soft warning. See
CHANGELOG.md and UI_ELEMENTS.md 2026-07-20 ("Content-script login gating") for full detail.
`utils/authGate.js` is the shared gate; checked at content-script startup and again when the
sidebar's play/pause is turned on. Logged out ⇒ zero extension DOM on the Relay page.

### Live cross-context reactivation on login/logout (PLANNED)
Logging in or out via the popup does not retroactively activate/deactivate an already-loaded
Relay tab — the gate is only evaluated at content-script startup and at toggle-time, so a
tab reload is currently required to pick up a login/logout that happened after the page
loaded. Would need the content script to listen for `SUPABASE_SESSION_KEY` changes via
`chrome.storage.onChanged` and either retroactively call `buildSidebar()`/`initManualToggle()`
(login) or tear the sidebar down and stop the loop (logout) — not implemented, deferred until
there's a concrete reason a reload isn't acceptable.

> **Stale entry (noted 2026-07-30, left as-is):** this was actually implemented 2026-07-20 —
> `onAuthGateChange` in `utils/authGate.js` drives `activateExtensionUI()` /
> `deactivateExtensionUI()` live, no reload needed. Flagged rather than rewritten because it's
> outside the current task's scope; fold it into the next doc-drift pass.

### Activation lockout (audit B1) ✅ FIXED 2026-07-30 — three follow-ups left open

The fix itself (`content/content.js` only) is in CHANGELOG.md 2026-07-30; browser test steps
are TC-AUTH-8. Three things it deliberately did **not** do:

- **Logout arriving mid-activation (PLANNED, real bug).** If the gate closes while
  `activateExtensionUI()` is awaiting `tabState.init()`, `deactivateExtensionUI()` early-returns
  (`_extActivated` is false during the flight) and the in-flight activation then builds a
  sidebar for a logged-out session. Equally broken before the B1 fix, just in a different shape.
  Likely fix: recheck `isAuthGateActiveSync()` after the await and bail — the same pattern
  `shouldContinue()` already uses in the tick pipeline. Needs its own task; it changes the
  activation flow, which B1's task scope excluded.
- **`ext-sidebar-styles` `<style>` tag leaks on teardown (PLANNED, cosmetic).**
  `buildSidebar()` appends it to `document.head` (sidebar.js:214); `deactivateExtensionUI()`
  removes `#ext-sidebar` but not the style tag, so a copy accumulates per deactivate→activate
  cycle. Harmless today (the rules are identical and `buildSidebar()`'s own guard prevents a
  second sidebar), but it breaks the "page reverted to untouched state" guarantee that function
  claims in its own comment. Relates to the memory-leak/caching audit item about style-injection
  idempotency (see "Step 3 — Memory-leak / caching audit" above).
- **User-visible signal when activation fails (NOT APPROVED — needs a PM decision).** A failed
  activation is currently console-only. The dispatcher sees no sidebar and no explanation; the
  fix guarantees they can recover (log out/in, or the next gate change retries) but not that
  they'll know to. Whether that warrants on-page UI, and what it should look like without
  looking like an Amazon error, is an open product question.

---

## Rebrand to "Torren Relay" — finish EXT_NAME (PLANNED)

2026-07-17's rebrand only covered `manifest.json` (`name`, `default_title`) and the popup
header (`<title>`, `.popup-title`) — explicitly scoped that way by the PM. Still outstanding:

- `utils/constants.js`'s `EXT_NAME` constant is still `'Amazon Relay Helper'`. It feeds
  `content/sidebar.js`'s `ext-sidebar-title` (the floating bar injected on the Relay page
  itself), so the on-page sidebar still shows the old name — a visible mismatch against the
  popup, which now says "Torren Relay".
- `manifest.json`'s `description` was also explicitly left as-is, pending a full copy rewrite
  before Web Store submission.

Update `EXT_NAME` (and anywhere else it's read) once the PM confirms the sidebar should move
too — likely bundled with the pre-submission copy rewrite rather than done piecemeal.

---

## Multi-domain support ✅ DONE (2026-07-17)

`manifest.json` `host_permissions`/`content_scripts.matches` expanded from `relay.amazon.com` only to all 11 Amazon Relay regional domains (ca, co.jp, co.uk, com, cz, de, es, fr, it, in, pl). Codebase audit found no hardcoded `relay.amazon.com` strings outside manifest.json; `content/patApi.js` already uses relative fetch paths. See CHANGELOG.md 2026-07-17.

### Non-US locale handling (PLANNED, blocked)
Non-US locale handling (city/address formats, API response differences) — blocked until real captured data from a non-.com domain.

---

## Future manifest additions (DO NOT add until the feature lands)

| Permission | Feature |
|-----------|---------|
| possibly `tabs` | Tab Alert (may not be needed depending on approach) |

---

## Stages 15–18 (original MVP plan)

- Stage 15: Performance hardening
- Stage 16: Error handling pass
- Stage 17: Safety audit (grep for .click(), FORBIDDEN checks, 30-min live test)
- Stage 18: Final build + packaging
