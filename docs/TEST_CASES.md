# Test Cases

## TC-FASTBOOK-IDENTITY — Fast Book must abort if the sheet shows another load (2026-08-27)

> ⚠ **UPDATED LATER THE SAME DAY.** The identity check below was correct but read the load id
> from a place that never had it, so **Fast Book was blocked on every press**. The id now comes
> from `.load-card__selected` on the board, and a **second gate (payout)** was added. The steps
> in *"Rehearsing the guard"* are the current ones. See the DEAD HYPOTHESIS note below.

### ⛔ DEAD HYPOTHESIS — do not test this, and do not re-derive it

**The detail sheet does not carry the load id.** Measured on a live board 2026-08-27: zero UUIDs
anywhere in `#selected-work-sheet`, in any id or attribute; the URL stays `/loadboard/search`.
Any future "read the id from the sheet" idea is this bug returning.

### The three abort states are DELIBERATELY distinguishable

| what happened | outcome | button reads | testid |
|---|---|---|---|
| `.load-card__selected` matched nothing (**Amazon changed**) | `abort-no-marker` | Blocked — cannot identify open load | `ext-action-fastbook-blocked-marker` |
| the open load is a different one | `abort-identity` | Blocked — wrong load open | `ext-action-fastbook-blocked` |
| the payout disagrees | `abort-payout` | Blocked — payout mismatch | `ext-action-fastbook-blocked-payout` |

🔑 **If Fast Book ever reads "Blocked — cannot identify open load", that is not a wrong-load
refusal — it means every press will block until the marker is re-measured.** Report it.

🔑 **THIS CASE CANNOT BE PRODUCED ON DEMAND ON A REAL BOARD.** It requires Amazon's sheet to be
showing a *different* load from the panel's at the instant Fast Book is pressed. **The guard is
therefore asserted by `fastbook-suite` and by nothing else** (the console rehearsal below lets
you *watch* it fire on a live board, but it does not replace the suite) — treat that suite as the
evidence, and do not weaken it.

### What the suite asserts (`fastbook-suite`, 85 checks)

| case | expected |
|---|---|
| sheet id **==** bound id | Book **is** clicked, the confirm poll starts, no error — the happy path is unchanged |
| sheet id **≠** bound id | **NO click, NO poll**, `logger.error` naming **both** ids, button left disabled reading *"Blocked — wrong load open"* |
| sheet has **no** UUID | **NO click** — fail closed |
| **bound** id missing | **NO click** — fail closed |
| **both** missing | **NO click** — ⚠ `null` must never equal `null` here |
| bound id is an **empty string** | **NO click** — fail closed |
| **no sheet at all** | **NO click** — fail closed |

### What Ihor CAN check on a real board — the HAPPY path only

1. Open a load, press **Fast Book**. **PASS:** it books exactly as before — button goes
   `Booking...` then `Booked!`. **FAIL:** it now says *"Blocked — wrong load open"* on a
   normal booking, which would mean the sheet id and the card id disagree on an ordinary open —
   report it immediately and **do not** press again.
2. Repeat on a **recently-added** (highlighted) card, whose id comes through the UUID-shape rule.
3. **PASS:** the confirm dialog is still found and clicked within the usual time. **FAIL:** it
   sits at `Booking...` for 5 s then reverts — that is the scoped fallback no longer finding
   the confirm button, which would mean Amazon portals the dialog outside the sheet.

### Rehearsing the guard from the console — added 2026-08-27

🔑 **The abort path still cannot be produced on demand on a real board.** These two helpers let
Ihor *watch* the guard decide, on the live sheet, with **no booking possible**. They are console
helpers on `__EXT_DEBUG` — no UI, no new branch in the normal flow.

**A. `__EXT_DEBUG.fastBookDryRun()` — runs every real check, stops before the click**

1. Open a load card so the inline panel is showing.
2. In the DevTools console: `__EXT_DEBUG.fastBookDryRun()`
3. **PASS (normal case):** the block ends `-> WOULD CLICK` and `NOTHING WAS CLICKED.`, with the
   two ids identical and `outcome : dry-run-would-click`.
4. **FAIL:** `-> WOULD ABORT` on an ordinary open — the sheet id and the panel's bound id
   disagree where they should agree. Capture the block and report it; **do not** press Fast Book.
5. With no panel open it prints `no inline panel is open. Click a load card first.` and returns
   `null`.

**B. `__EXT_DEBUG.fastBookForceMismatch()` — makes the NEXT real press abort, once**

1. Open a load card. Run `__EXT_DEBUG.fastBookForceMismatch()` — it prints `ARMED for ONE press`.
2. Press **Fast Book** for real.
3. **PASS:** nothing is booked; the button is left **disabled** reading
   **"Blocked — wrong load open"** with `data-testid="ext-action-fastbook-blocked"`; the console
   carries a `REHEARSAL` warning naming the real id and an `executeFastBook: ABORTED` error
   naming **both** ids.
4. **FAIL:** anything books. That would mean the identity check did not run.
5. **It is one-shot.** Press Fast Book again on the same panel and it books normally — that
   second press is part of the test, and confirms the flag cleared itself.

⚠ **WHAT THESE HELPERS DO NOT COVER.** A dry run returns *before* `bookBtn.click()`, and a forced
mismatch aborts before it, so **the two real clicks (Book, then confirm) and the confirm poll are
never exercised by either helper**. Nothing but a **genuine booking on a real board** covers those
— steps 1-3 of the section above remain the only evidence for them, and remain unperformed.

### The dry run now prints BOTH gates (2026-08-27)

`__EXT_DEBUG.fastBookDryRun()` prints the marker state, then gate 1 and gate 2 separately.
**PASS on an ordinary open load:**

```
      sheet present                 : true
      selected-card marker          : found

      GATE 1  identity
        bound load id (this panel)  : 9f2c1d40-…-2e6d4b90a771
        load id on the SELECTED card: 9f2c1d40-…-2e6d4b90a771
        ids match                   : true

      GATE 2  payout
        record payout               : $835.73
        amounts read from the sheet : $835.73, $2.17
        verdict                     : PASS  (the record payout appears in the open sheet)

      -> WOULD CLICK  (both gates cleared; a real press would book this load)
      NOTHING WAS CLICKED.
```

**Then open a DIFFERENT load, leaving the panel bound to the first, and run it again. PASS:**
`ids match : false`, `outcome : abort-identity`, and `-> WOULD ABORT`.

⚠ **`verdict : ABSTAINED` is NOT a failure.** It means the payout gate had nothing to compare —
usually no captured record for that load yet — and the booking rests on gate 1 alone. The final
line then reads `WOULD CLICK (identity cleared, payout abstained)`, which is the design.

⚠ **`selected-card marker : NOT FOUND` IS a failure**, and a serious one: every press will block
until `.load-card__selected` is re-measured against the live board.

⚠ **If the blocked state ever appears, that is the guard working, not a bug.** Capture the
`executeFastBook: ABORTED` console line — it carries both ids — and send it.

## TC-CITY-STOP — a load whose pickup is a CITY, not a facility (2026-08-24)

**Why:** 16 of 17 loads went unassigned because their first stop was city-level —
`"LOCKBOURNE, OH"` with `stopCode`, `line1`, `postalCode` and both coordinates all null.

### Steps
1. Open the board in the state that failed (Required equipment, or any board with vendor
   pickups). `CITY_ASSIGN_DEBUG = true`.
2. **PASS:** the **All badge is empty** and no card says *"Origin not determined"*.
   **FAIL:** a count remains — read the `CITY WHY-UNASSIGNED` lines; each now says whether a
   city-level stop was seen and why it could not be resolved.
3. Read the `CITY ASSIGN` line's `positions:` segment.
   **PASS:** `positions: N facility + M CITY CENTROID (±3-10 mi, accepted 2026-08-24)`.
   **FAIL:** no centroid reported on a board that has city-level pickups — the resolution did
   not run.
4. Read `CITY STOPS resolved N load(s) from M distinct city(ies)`.
   **PASS:** M is the number of **distinct** pickup cities, not the number of loads. Twenty loads
   out of one city must cost **one** lookup.
5. Refresh several times. **PASS:** `CITY STOPS` reports 0 newly resolved after the first cycle —
   the cache is holding. **FAIL:** it re-resolves every refresh; that is a network cost per tick.
6. Click a city tab. **PASS:** the city-level loads appear under the right city.

### The state-name case
7. Find a load whose stop state is a **full name** (`"Illinois"`, `"Ohio"` — both appear in the
   2026-08-24 capture). **PASS:** it resolves and is assigned.
   **FAIL:** `** CITY-LEVEL STOP "X, Illinois" ... THE STATE IS NOT RECOGNISED **` — the
   normalisation table is missing that name. ⚠ It must **never** truncate to a guess.

### The accuracy this accepts
8. ⚠ A city centroid is **not** the pickup facility — median 3.3 mi, max 18.8 mi from the real
   building. **Ihor accepted this on 2026-08-24.** At 250 mi it is irrelevant; at a 50 mi radius a
   load near the boundary could land in a neighbouring city. If that ever matters, the fix is a
   smaller radius question, not a coordinate question.

## TC-REQ-CAPTURE — the /search REQUEST is read without disturbing the board (2026-08-20, PART 1)

**Why:** the dispatcher's per-city radius is in the request body. Reading it must cost the board
nothing — this is the same file that once broke the board by cloning a response.

### Steps
1. Load the board, start the loop, let it refresh a few times.
   **PASS:** the board renders and refreshes exactly as before. **FAIL:** anything slower,
   blank, or erroring — stop and report, the read is not free.
2. Console: `__EXT_DEBUG.dumpSearchRequest()`.
   **PASS:** it prints `radiusFilters`, `originCities` and `startCityRadius`.
   **FAIL:** `nothing captured yet` after several refreshes — the body is not a plain string;
   look for the `[Torren Relay] Could not read your search radius` warning, which names the shape.
3. 🔑 **Read the key names on the first radius filter entry.** That is what Part 2 is waiting
   for. With `CITY_ASSIGN_DEBUG = true` the receiver prints them outright.
4. **PASS:** the printed object contains **no** `savedSearchId`, **no** `minPayout`, **no**
   `minPricePerDistance`. **FAIL:** any of them present — the projection is leaking.
5. Save the output into `samples/search-request-<date>.json` (samples/ is gitignored).

## TC-RADIUS-MEMBERSHIP — per-city radius drives membership (2026-08-20, PART 2 — BUILT)

✅ **Part 2 landed.** The field is `radius`, a bare number, one per city.

| # | case | expected |
|---|---|---|
| 1 | a load **within** a city's own radius | assigned to that city, appears under its tab |
| 2 | a load **beyond every** city's radius | **All only**, marked *"Origin not determined"* — rule 9a unchanged |
| 3 | two cities with **DIFFERENT** radii (say 50 and 250) | each assigns by **its own** number; a load 120 mi from both is in the 250 city and **not** in the 50 city |
| 4 | a load in range of **two** cities | appears under **both** — membership is still every city in range, **not** nearest-wins |
| 5 | the radius for a city **cannot be read** | **reported, never defaulted** — the console carries `Could not read your search radius`, and the report says what limit was used instead |
| 6 | the radius unit is absent or unrecognised | **no conversion is performed** and it is said out loud; miles is never assumed |

⚠ **Case 5 is the one that matters most.** Silently falling back to 150 reinstates the exact
defect: at radius 250 it marks six legitimately-returned loads unassigned, at radius 50 it puts a
122 mi load under the HEBRON tab.

## TC-ALL-BADGE-EMPTY — the acceptance criterion, and a permanent self-check (2026-08-20)

🔑 **After Part 2 the "All" badge must be EMPTY.** Amazon only returns loads already inside the
dispatcher's radius of one of his selected cities, so once our membership uses that same radius,
every returned load belongs to at least one city and **nothing can be unassigned**.

⚠ **This makes the badge a permanent self-check. A count on it is a BUG — our radius has diverged
from Amazon's — NOT expected noise.** Treat it as a signal, not as background.

### Steps

1. Load the board with the loop running and the filter on **All**.
2. **PASS:** the All badge shows **nothing**. No card carries *"Origin not determined"*.
   **FAIL:** any count at all — capture the console and report it. The `CITY WHY-UNASSIGNED`
   lines name the load, its coordinates, and its distance against **each city's own radius**.
3. **PASS:** the board's **total load count is unchanged** from before the change. Only which tab
   each load appears under may differ.
   **FAIL:** loads have disappeared — that is a membership regression, not a filtering one.
4. Change your radius in Amazon's filter (say 250 → 50) and let the board refresh.
   **PASS:** loads move between tabs to match, and the badge stays empty.
   **FAIL:** the badge fills up — our capture is stale; check the console for
   `Could not read your search radius`.
5. Console: `__EXT_DEBUG.getSearchRequest()`.
   **PASS:** `radiusFilters` shows your **current** radius per city.
6. Look at the `CITY ASSIGN` line's `radius:` segment.
   **PASS:** each city shows your number. **FAIL:** any `(FALLBACK)` — that city is on the
   built-in 150, which is **not** your setting, and the console will have said so by name.

## TC-ALL-ONLY — an unassigned load appears under "All" and under NO city tab (2026-08-20)

**Why:** a YORK, PA load appeared under the HEBRON, KY tab. Ihor: a dispatcher who thinks he is
booking near Hebron and is 450 miles away is a money problem, not a cosmetic one.

⚠ **Rule 9 is REFINED, not overturned.** Both halves must hold in the same run: **hidden under
every city**, and **visible AND counted under All**. Checking only one half proves nothing.

### A. A load beyond the max distance from every active city
1. Board with several origin cities and at least one load far from all of them (the YORK case).
2. Click each city tab in turn.
   **PASS:** that load appears under **none** of them.
   **FAIL:** it shows under any city tab — the defect is back.
3. Click **All**. **PASS:** the load is visible **and carries a badge reading "Origin not
   determined"**. **FAIL:** visible but unmarked — the dispatcher cannot tell it is unplaced.

### B. A load with no captured coordinates
Repeat A with a load the capture never saw. **PASS:** identical behaviour — All only, marked.
**FAIL:** the two categories behave differently; they must not.

### C. Both are counted on the All badge
4. Count the marked cards under All. **PASS:** the number on the **All** badge equals that count.
   **FAIL:** the badge is lower — it is probably counting only the never-captured ones, which is
   the bug this fixed.
5. Click the badge. **PASS:** the unmatched-only view shows exactly those cards, still marked.

### D. A load in range of TWO cities still appears under both
6. Find a load whose origin is within the max distance of two active cities.
   **PASS:** it appears under **both** tabs and is **not** marked.
   **FAIL:** it appears under only one — membership has become nearest-wins, which it must not.

### E. Nothing flickers
7. Sit on **All** for a minute while the loop refreshes.
   **PASS:** the markers stay put; no flashing, no reflow.
   **FAIL:** they blink each cycle — the reconcile has stopped being idempotent, which is what
   caused the ~27 wakes/sec observer loop in 2026-08-19.

## TC-WHY-UNASSIGNED — the diagnostic names the cause (2026-08-20)

**Setup:** `CITY_ASSIGN_DEBUG = true`.

1. Load the board and let one assignment cycle run.
2. Look for `CITY WHY-UNASSIGNED`.
   **PASS:** one line per unassigned load, plus a header naming the active cities and the 150 mi
   limit.
3. For the YORK load, the line should read **`OUT OF RANGE`** with its coordinates, the nearest
   city and the distance, and the distance to **every** active city.
   **FAIL (different cause):** it reads `NO COORDINATES` — then the load was never captured, and
   the line says which lookup came back empty and which endpoint listed it.
4. **PASS:** the header states that `CITY_ASSIGN_MAX_MILES` was not changed. Whether 150 is right
   is PLAN 16 and is Ihor's call, not something to infer from these lines.

## TC-RECENT-CARD — a recently-added card renders the panel (2026-08-20)

**Why:** measured failure 1. The recently-added card has **no `div.load-card` ancestor**, so the
panel's class-based lookup found nothing: Amazon opened its own sheet and we rendered nothing.

⚠ **Three separate lookups had the same defect** — the click handler, the load id, and the
ANCHOR check. Testing only "does it resolve" would have passed while the panel still refused to
render, so this case is written end to end.

### Steps
1. Load board, loop running, so a "recently added" card appears (it is the highlighted one at the
   top — ⚠ identify it by its highlight, **never** by the words "Recently added", which are not
   always rendered).
2. Click that card **on an inner element** — a city name, a price, a time. Not its outer padding.
   **PASS:** Amazon highlights the card **and our panel renders below it**.
   **FAIL:** Amazon highlights it and no panel appears — the old failure.
3. Check the panel is bound to **that** load: its stops must match the card above it.
   **FAIL:** it shows another load's stops — it bound to the wrong id.
4. Click an **ordinary** card the same way. **PASS:** unchanged, panel renders, ids match.
5. Click the recently-added card on its **outer padding** (the few pixels at its very top or
   bottom edge). **PASS:** **nothing happens** — no panel, no highlight. The 2026-08-19 container
   guard is deliberately unchanged, and Amazon ignores that click too.

## TC-ZERO-BOX — a card with no layout box DEFERS instead of clicking (2026-08-20)

**Why:** measured failure 2 — `card is 0x0`, `highlight=FALSE`, and Amazon did not react either,
because the click was dispatched at an element with no box.

### Steps
1. `CITY_ASSIGN_DEBUG = true`. Start the loop and let several auto-opens happen.
2. Watch the console for `card has no layout box yet — deferring the click one frame`.
   **PASS:** if it appears, the very next auto-open block still ends `OPENED` — it waited and
   then clicked, rather than clicking into the void.
   **FAIL:** it appears and is followed by a `NOT OPENED` on a card that is plainly on screen.
3. If a card never lays out, the log reads `still had a 0x0 box after 10 frames — no click was
   sent`. **PASS:** that is the clean give-up. **FAIL:** the message repeats forever — the retry
   is meant to be bounded at 10.
4. **Every AUTODIAG block now prints `card box:` and `target box:`.** **PASS:** `laid out`.
   **FAIL:** `** 0x0, NOT LAID OUT **` on a card you can see — that is a different bug.

## TC-CLICK-COORDS — the dispatched click carries a point inside the target (2026-08-20)

**Why:** all five measured attempts logged `click (0,0) ** OUTSIDE ** the innermost interactive
element's box`. Amazon tolerated it three times out of five.

### Steps
1. `CITY_ASSIGN_DEBUG = true`, loop running, let an auto-open happen.
2. Read the `X1 EVENT` line.
   **PASS:** `MouseEvent type=click`, and `client=(x,y)` with **x and y non-zero**.
   **FAIL:** `client=(0,0)` — the dispatch has regressed to `HTMLElement.click()`, which cannot
   carry coordinates.
3. Read `C3 ZONE` in the CLICKDIAG block for the same click.
   **PASS:** the point is reported **INSIDE** the innermost interactive element's box.
   **FAIL:** `** OUTSIDE **`.
4. **PASS:** exactly ONE click event per attempt. **FAIL:** any `pointerdown` / `mousedown` /
   `mouseup` alongside it — none was added and none may be.

## TC-AUTODIAG — capturing why auto-open sometimes does not open the sheet (2026-08-20)

**Diagnostic run, not a pass/fail test.** The point is to collect blocks, including from
attempts that WORK — X5 can only name what differed if it has a successful attempt to compare
against.

### Setup

`CITY_ASSIGN_DEBUG = true` in `utils/constants.js`. `DEBUG_LEVEL` does **not** matter — AUTODIAG
prints with `console.log` precisely so it works at the stock level.

### Steps

1. Load board, Auto-Open ON, loop started. Leave the tab in the **FOREGROUND**.
2. Let **three or four** auto-opens happen. Do not touch the mouse — a manual click is a
   different path and will not produce an AUTODIAG block.
3. Switch to another tab and leave the board in the **BACKGROUND** for at least **six minutes**,
   so Chrome's *intensive* timer throttling has time to engage. Let several more auto-opens
   happen.
4. Come back and run `__EXT_DEBUG.dumpAutoOpenDiag()`.

### What to send back

Every `[AUTODIAG]` line, plus the table. The blocks that matter most are **a pair**: one reading
`X5 VERDICT   OPENED` and one reading `X5 VERDICT   ** NOT OPENED **`. A failure with no success
beside it cannot be diagnosed — X5 will say so rather than guess.

### How to read it before sending

| line | what it settles |
|---|---|
| `X1 WHERE ... target === div.load-card container: ** YES **` | the click went to the container — Amazon ignores those |
| `X1 RESOLVE ... ** FELL BACK to the card element **` | why it went there |
| `X1 RESOLVE ... COVERED BY OUR OWN UI` | our own bar or panel was over the point |
| `X1 EVENT ... isTrusted=false ... NO preceding pointerdown` | what a synthetic click does and does not send |
| `X2 GUARD ... returns early: ** YES **` | our panel would not render — but Amazon still got the click |
| `X3 TIMER ... ** LATE **` | background-tab timer throttling, measured |
| `NO CLICK WAS SENT` | nothing was clicked at all — a different failure entirely |

⚠ **`X2 REACH` is printed on every block on purpose.** Our guard cannot swallow the click; it
only decides whether our panel renders. If X5 blames X2, the mechanism is Amazon ignoring a
container-targeted click, not the guard intercepting anything.

### Before shipping

Set `CITY_ASSIGN_DEBUG` back to `false`. With it off, AUTODIAG prints nothing and registers no
listener at all — asserted by `autodiag-suite`.

## TC-U1-INDICATOR-CLEARS — the tab indicator must DISAPPEAR after viewing (2026-08-20)

**Why:** this is the defect U1 fixed, not a cosmetic preference. Removing our `<link>` does not
make the browser re-read the page's own icon, so the tab kept our mark after the alert stopped.

### Steps
1. Tab Alert ON in the popup. Start the loop on a load board, then switch to **another tab**.
2. Wait for a new load. **PASS:** the board tab title alternates with `• New load` (or
   `• N new loads`) and its favicon breathes softly — one hue, two alphas, about one pulse a
   second. **FAIL:** a solid red or yellow square, or a fast strobe.
3. Switch **back** to the board tab.
   **PASS:** the title returns to Amazon's own AND **the favicon returns to Amazon's own**.
   **FAIL:** the favicon stops moving but our dot is still sitting there — the defect is back.
4. Repeat 2–3 twice more without reloading. **PASS:** it restores every time.

⚠ Watch the favicon, not just the title. The title always restored; the favicon was the bug.

## TC-U2-BUTTON-HEIGHT — every city button is the same height, badge or no badge (2026-08-20)

**Why:** the "All" button was visibly shorter. 🔑 **The badge is NOT the cause** — the reserved
badge slot keeps badges permanently in the DOM. The cause was `display`.

### Steps
1. Open a board with several origin cities, at least one carrying a new-load badge and at least
   one without.
2. Sight along the top and bottom edges of the row.
   **PASS:** "All" and every city pill are the **same height** — including cities whose badge is
   empty, and including "All", which never carries a count.
   **FAIL:** any button is short — check it resolves `min-height:var(--ext-city-btn-h)` and has
   `display:flex`; a button laid out as a block line box computes its height differently.
3. Let a city gain a badge while you watch (a new load arrives).
   **PASS:** **nothing moves** — no reflow, no jump. The slot was already reserved.

## TC-U5-TOAST — the toast dismisses while the loop STAYS STOPPED (2026-08-20)

**Why:** the message now fades by itself. The danger is that its disappearance gets read as
"everything resumed". It must not be.

### Steps
1. Loop running. `__EXT_DEBUG.simulateRateLimit(503, 3)` — three consecutive, so the threshold is
   reached. **PASS:** the loop stops and the top-bar toast **fades in** reading
   **"Server is taking a short technical pause"**. **FAIL:** it says "Amazon", or it appears
   instantly with no fade.
2. Do nothing for about 7 seconds. **PASS:** the toast **fades out** by itself.
3. Now look at the play/pause control. **PASS:** it still shows **stopped**, and no requests are
   going out. **FAIL:** the loop is running again — nothing may auto-restart it, least of all a
   display timer.
4. Press play. **PASS:** the loop restarts and the toast does not reappear.
5. Fire step 1 again and press play **while the toast is still visible**.
   **PASS:** the toast clears immediately and does **not** reappear 7s later — the timer was
   cleared on the explicit hide.

## TC-RATE-THRESHOLD — one or two rate-limit responses must NOT stop the loop (2026-08-20)

**Why:** Amazon returns the odd isolated 502 with no throttling behind it. Stopping on that costs
the dispatcher loads. The stop waits for **three consecutive** responses.

⚠ **Backoff still engages on the first** — that is the pacing mechanism and is correct. Only the
**stop and the message** wait for the threshold.

### Steps — one tab, loop running

1. `__EXT_DEBUG.simulateRateLimit()` — **one** event.
   **PASS:** the loop keeps running, **no message**, console reports `1 of 3`.
   **FAIL:** the loop stops — the threshold is not being applied.
2. `__EXT_DEBUG.simulateRateLimit()` again — **two** consecutive.
   **PASS:** still running, still no message, `2 of 3`.
3. `__EXT_DEBUG.simulateRateLimit()` a third time — **three** consecutive.
   **PASS:** the loop **stops** and the top-bar message appears. `3 of 3`, `THRESHOLD REACHED`.
4. Press play to restart (the message clears). Then:
   `__EXT_DEBUG.simulateRateLimit()` → `__EXT_DEBUG.simulateRecovery()` →
   `__EXT_DEBUG.simulateRateLimit()` → `__EXT_DEBUG.simulateRecovery()` →
   `__EXT_DEBUG.simulateRateLimit()`
   **PASS:** the loop is **still running** — each success reset the count, so three *scattered*
   events never add up. Every simulate reports `1 of 3`.
   **FAIL:** it stops — the counter is cumulative, which is the bug this guards.
5. Shortcut: `__EXT_DEBUG.simulateRateLimit(503, 3)` fires all three at once and must stop the
   loop immediately.

### Also still true

No auto-restart when the backoff clears; the message clears only on restart; no "Shared refresh
limit" toggle in the popup.

## TC-RATE-PAUSE — throttling stops the loop and shows the calm message (2026-08-20)

Replaces the four-tab aggregate test: with the shared limit shipping OFF there is no aggregate
behaviour left to check. **One tab is enough.**

### Steps

1. Start the auto-refresh loop.
2. Run `__EXT_DEBUG.simulateRateLimit()` — it injects a **429/503-class status into the real
   backoff path**, the same one Amazon's response reaches.
3. **PASS:** the loop **stops by itself** (play/pause flips to stopped), and the top bar shows:
   *"Amazon is taking a short technical pause / The server has paused new loads because of frequent
   requests. Pause auto-refresh for 5-10 minutes and it will return to normal on its own."*
   **FAIL:** the loop keeps refreshing, or the message appears only in the popup.
4. Wait for the backoff to clear (or run `__EXT_DEBUG.simulateRecovery()`).
   **PASS:** the loop stays **stopped** and the message stays up.
   **FAIL:** it restarts on its own — that is the behaviour D2 forbids.
5. Press play.
   **PASS:** the loop runs and **the message clears**.
6. Open the popup.
   **PASS:** there is **no "Shared refresh limit" toggle**, and the bar reads
   *"Refresh every X.Xs"* (never "Shared rate:").

### Tone check — this is a requirement, not decoration

The message must contain no "error", "blocked", "banned" or "violation", show **no warning icon**,
use **no red**, and play **no sound**. If it reads as an account threat, it is wrong.

## TC-RATE-4TAB — the cross-tab rate limit (PLAN 10) — the last pre-launch blocker

**Needs four real tabs and a human.** No automation exists for it. ⚠ Turn on
`CITY_ASSIGN_DEBUG = true` and `DEBUG_LEVEL = 3` for the per-request lines; the summary command
works at any level. **Console filter: `RATEDIAG`.**

### Part A — the aggregate rate

1. One tab. `__EXT_DEBUG.rateDiagOn()`, start the loop, wait ~60 s, `__EXT_DEBUG.rateDiag()`.
   **PASS:** mean interval ≈ the configured interval, verdict **AGREES**.
2. Open three more tabs on the board, start the loop in each. Wait ~60 s.
3. In **any one** tab: `__EXT_DEBUG.rateDiag()`.
   **PASS:** `requests across ALL tabs` roughly quadruples, the **mean interval stays the same**,
   verdict **AGREES**, and PER TAB shows all four contributing.
   **FAIL:** mean interval drops toward interval÷4 — that is the 4× defect this test exists for.

### Part B — pause and resume across all four

4. In any one tab: `__EXT_DEBUG.simulateRateLimit()`. It injects a 503 into the **real** backoff path.
5. Watch **all four** consoles.
   **PASS:** every tab logs `no permit — rate limiter active`, and `rateDiag()` shows
   `backoffUntil` set, `backoffStepIndex` advanced, `rateLimited true`.
   **FAIL:** any tab keeps refreshing.
6. `__EXT_DEBUG.simulateRecovery()`.
   **PASS:** all four resume together; `backoffUntil none`, `backoffStepIndex -1`,
   `rateLimited false`.

⚠ **Do NOT use DevTools request blocking for this.** It produces a failed request with **no HTTP
status**, which is not in `RATE_LIMIT_STATUSES`, so it takes a different branch and is a complete
no-op. It would look like a failure when nothing was wrong.

⚠ **What step 4 does NOT prove:** that a genuine Amazon 503 arrives as status 503. Only a real 503
exercises the networkObserver → content.js relay.

### Copy back

The `RATEDIAG AGGREGATE`, `RATEDIAG PER TAB` and `RATEDIAG STATE` lines from step 3, and the
`RATEDIAG STATE` lines from steps 5 and 6.

## TC-PAT-TRAILER — trailer ownership from the P/R badge (2026-08-20)

⚠ **This is the ONLY DOM-sourced field in the PAT payload.** It is an authorised interim
exception to the "one id plus one API record" directive. See BACKLOG 0p.

**Automated:** `pattrailer-suite` (58 checks), invoking `openPostModal()` end to end.

### Steps

1. Open PAT on a load whose card badge is **P** → the summary reads **(Provided)**, Confirm
   **ENABLED**.
2. Open PAT on a load whose card badge is **R** → the summary reads **(Required)**, Confirm
   **ENABLED**.
3. ⚠ **The R branch has never been verified against a real post.** After confirming an R post,
   check on Amazon that the posted trailer type really is carrier-owned.
4. A card with no badge, or an unexpected letter, leaves **Confirm DISABLED** with the raw value
   named — never defaulted to Provided.

### Label collection (PART 2)

5. Work the board normally, then run in the extension's console context:

   ```
   __EXT_DEBUG.dumpTrailerLabels()
   ```

   It prints a count of P and R labels and the collected pairs between
   `----- BEGIN TRAILER LABELS -----` / `----- END TRAILER LABELS -----`. **Works at the shipped
   `DEBUG_LEVEL`** — it uses `console.*`, not `logger.*`.
6. The label survives a normal board re-render, and `teardownCityAssign()` clears it.

### Fails if

- An R card posts **Provided**, or the summary still reads "(Provided)" for it.
- A card with no badge posts anything at all rather than blocking.
- `dumpTrailerLabels` prints nothing after working a board with cards on it.

## TC-PAT-PAYLOAD — the posted values match a real captured upsert (2026-08-19)

**Why it exists.** Ihor captured a genuine Post-a-Truck upsert (DevTools Offline — built, never
sent). It settled four values, one of which the extension was getting **wrong**.

**Automated:** `patalign-suite` (54 checks), end to end through `openPostModal()`.

### Steps — open PAT on three loads

| load | Driver must read | Confirm |
|---|---|---|
| a **team** load (e.g. `d075a306`) | **Team** | **enabled** |
| a **solo** load (e.g. `743eaba0`) | **Solo** | **enabled** |
| an **R** load (carrier-owned badge) | Solo or Team per the record | enabled |

On all three: **Loading Type reads "Live or Drop & Hook"**, and the summary shows the equipment
label.

### Expected payload values

| field | value | backed by |
|---|---|---|
| `loadingTypeList` | `["LIVE"]` | capture §7a |
| `driverTypes` (solo) | `["SOLO"]` | capture §3 |
| `driverTypes` (team) | `["TEAM"]` | capture §7 |
| `equipmentTypes` | ARRAY | capture §7 |
| `visibleEquipmentTypes` | STRING, same value | capture §7 |
| `providedTrailerType` | `"AMAZON_PROVIDED"` | capture §3 |

⚠ **The R load will still post `AMAZON_PROVIDED`.** Both constants are known, but nothing in the
record says which a load is — BACKLOG 0n. That is expected today, not a new fault.

### Fails if

- Loading Type posts `["LIVE","DROP"]` → the correction was reverted. That shape has never been
  observed.
- A team load posts `["SOLO"]`, or Confirm is disabled on a team load.
- A 26' Truck load is refused as unsupported → the L3 mapping is missing.
- A **40' Container** load is *accepted* → it must still be refused; it is not capture-backed.

## TC-PAT-DRIVER — the posted driver type comes from the LOAD (2026-08-19)

**Why it exists.** `driverTypes` was hardcoded `['SOLO']`, so a TEAM load posted silently as
solo. Measured live: load `743eaba0` `SINGLE_DRIVER` → `["SOLO"]` (correct by luck) and load
`d075a306` `TEAM_DRIVER` → `["SOLO"]` (wrong, and nothing blocked it).

**Product rule:** the driver type is a property of the LOAD, not a choice. Strictly one to one, no
default, no fallback, **no dispatcher override** — the field is read-only by design.

**Automated:** `patdriver-suite` (57 checks), invoking `openPostModal()` end to end and asserting
the **rendered** value and the Confirm state.

### Steps

1. `CITY_ASSIGN_DEBUG = true`, `DEBUG_LEVEL = 3`. Reload.
2. Open PAT on **load 743eaba0 (SOLO)** → Driver reads **Solo**, Confirm **ENABLED**.
3. Open PAT on **load d075a306 (TEAM)** → Driver reads **Team**, Confirm **DISABLED**, with the
   message *"This is a TEAM load. Posting it is blocked until the Team driver value is
   confirmed…"*.
4. In both cases the Driver field is plain text — **no dropdown, no way to change it.**

### Expected

| record `transitOperatorType` | modal shows | posts | Confirm |
|---|---|---|---|
| `SINGLE_DRIVER` | Solo | `["SOLO"]` | enabled |
| `TEAM_DRIVER` | **Team** | `["TEAM"]` | enabled *(unblocked 2026-08-19 by a real capture)* |
| anything else, null, or absent | the raw value | nothing — blocked | disabled |

🔴 **Why TEAM is blocked rather than posted.** The upsert's `driverTypes` value for a team post
appears in **no capture and no doc** — `api-samples.md` records only `["SOLO"]`, and the board's
`TEAM_DRIVER` belongs to a different API. Posting a guessed enum to the live marketplace is
exactly what this task forbids. **Send a manual Post-a-Truck upsert captured with Team selected**
and it becomes a one-line change.

### Fails if

- A team load shows **Solo** → the derivation is not on the path. **This is the dangerous case.**
- Any load posts `["SOLO"]` when the record does not say `SINGLE_DRIVER`.
- A dropdown or override appears on the Driver field → the product rule was broken.

## TC-PAT-STATE — a full state NAME must resolve like a state CODE (2026-08-19)

**Why it exists.** `resolvePATCity()` matches Amazon's cities API on its two-letter
`stateCode`. The record's `stops[].location.state` carries **both forms in the same field** —
measured 454/506 code, 52/506 full name. Every full-name stop failed on every match path, so the
modal showed *"Could not resolve city: «MONROE, Ohio»"* and Confirm stayed disabled.

**Automated:** `patstate-suite` (48 checks), which **invokes `openPostModal()` end to end** and
asserts a modal node exists — 52/52 full-name stops normalise, 154/154 records open a modal.

### Steps

1. Open the **MONROE, Ohio** load. Click **Post a Truck**.
2. **No "Could not resolve city" message appears.**
3. Origin reads **MONROE, OH** (code, not "Ohio").
4. **Confirm is ENABLED.**
5. Repeat on a load that already used a code (e.g. **LAFAYETTE, IN**) — unchanged behaviour.
6. Repeat on **INDIANAPOLIS, Indiana**, **BRISTOL, Indiana**, **SPARROWS POINT, Maryland**.

### An unrecognised state must fail loudly

There is no way to force this from the board, but the behaviour is asserted automatically: an
unknown value (e.g. "Freedonia") is **not** guessed, the console logs
`UNRECOGNISED state value … Add this value to PAT_STATE_CODE_BY_NAME` **with the raw value**, the
on-screen message names it, and **Confirm stays disabled**. If Ihor ever sees that log line, send
the raw value — it is the signal to extend the table.

### Fails if

- "Could not resolve city" still appears for a full-name load → the normalisation is not on the path.
- A city resolves to the **wrong state** → the table is wrong. **Report it; do not add a fuzzy
  fallback** — first-two-letters would map "New York" to NE (Nebraska).
- A previously-working code load stops resolving → the pass-through broke.

## TC-PAT-MODAL-OPENS — the modal must actually appear (2026-08-19)

**Why it exists. This is the THIRD time a green suite coexisted with a broken flow** — inline panel
Stage B, then PAT re-sourcing. `patsource-suite` had 62 green checks on
`patSourceFromRecord()` while clicking Post A Truck threw `ReferenceError: equipment is not
defined` and produced nothing at all. **Unit-testing the helpers is exactly what misses this.**

**Automated:** `patmodal-suite` (54 checks) — it INVOKES `openPostModal()` and asserts a modal
node is in the DOM, including for all **154/154** captured records.

### Steps

1. Open a load card so the panel renders. Click **Post a Truck**.
2. **The modal appears.** (Before this fix: nothing, with a clean console.)
3. **Loading Type reads "Live or Drop & Hook"** — on every load, whatever the board's own label says.
4. Every field is filled: Payout, Min/Max Miles, Stops, Start, End, origin, destination.
5. **Confirm is enabled.**
6. Summary line reads `Equipment: 53' Trailer (Provided) Loading Type: Live or Drop & Hook`.

### The three sub-cases for loading type

Post a Truck on a load the board labels **Drop**, one labelled **Live**, and one labelled
**LTL/Live/Drop**. All three must show **"Live or Drop & Hook"**. The third used to be refused
outright — it must now open and post.

### Failure must never be silent

If the modal cannot be built, a dialog saying **"Post a Truck could not be opened for this load /
Nothing was sent"** must appear, and the console must carry `openPostModal FAILED` with message,
stack and loadId. **A dead button with a clean console is the bug this test exists to prevent.**

### Fails if

- Nothing happens on click and the console is clean → the F2 wrapper is not in the path.
- Loading Type shows anything other than "Live or Drop & Hook" → F3 regressed to being
  load-dependent. **Do not "fix" it back — it is a product decision (see CHANGELOG 2026-08-19).**
- Confirm stays disabled → note WHICH field the modal names as missing.

## TC-PAT-RECORD — Post-a-Truck builds from the captured record alone (2026-08-19)

**Why it exists.** PAT was broken by PLAN 29a: it read `detail.header.stopsCount` (a path that no
longer exists) and re-parsed rendered time strings with an `M/D` regex that cannot match what
Stage B emits. Smoke item (e) FAILED live. PAT now sources every field from the captured record.

**Automated:** `patsource-suite` (62 checks, incl. 154/154 captured records resolving with nothing
missing). **Live-board status: NOT RUN — (e) stays FAIL until Ihor re-tests.**

### Steps

1. `CITY_ASSIGN_DEBUG = true`, `DEBUG_LEVEL = 3`. Reload. Open a load card so the panel renders.
2. Click **Post a Truck**.
3. **Every field must be filled** — Payout, Min/Max Miles, Stops, Start, End, origin, destination.
4. **Start time = the pickup's CHECKIN minus 30 minutes.** Compare against the first stop's time
   in the inline panel.
5. **End time = the last delivery's CHECKOUT plus 3 hours.**
6. **Stops equals the number shown on the load card.**
7. **Confirm is ENABLED.**
8. Read the `PATDIAG SOURCE` line: `record=` and `card=` must **agree** for payout, distance,
   equipment and loading type. Disagreement is a finding — the card value is never used, so a
   mismatch means the record and the board disagree and Ihor should send the line to the PM.

### Expected

| Field | Source | Check |
|---|---|---|
| Stops | `record.stopCount` | equals the card's stop count |
| Start | first stop `checkIn` − 30 min | 30 min before pickup |
| End | last stop `checkOut` + 3 h | 3 h after last delivery |
| Payout | `record.payout` × 1.10 | markup unchanged |
| Min/Max Miles | `record.totalDistance` ± 25 | window unchanged |
| Equipment | `loads[].equipmentType` enum → PAT constant | never via the display label |
| Loading type | last stop `unloadingType` | `DROP` → `["DROP"]` |

### Fails if

- Any field is still empty, or Confirm stays disabled → note WHICH field the modal names.
- An **unmapped equipment enum**: the console logs `UNMAPPED equipment enum` with the raw value at
  error level and the unsupported-equipment modal appears. **That is correct behaviour, not a
  bug** — send the PM a capture of that board. Only `FIFTY_THREE_FOOT_TRUCK` and
  `FIFTY_THREE_FOOT_CONTAINER` are mapped, because only those two are on disk.
- Start/end differ from the −30 min / +3 h rule → report; do not adjust the constants.

## TC-CLICK-CONTAINER — a click on the card's own padding must do nothing (2026-08-19)

**Why it exists.** Measured live with CLICKDIAG: when `event.target` was a DESCENDANT of the
card, Amazon highlighted the card and our panel rendered with **matching ids**. When
`event.target` **was `div.load-card` itself** — the container's own padding, a few pixels along
the top and bottom of a 72 px card — Amazon did **not** highlight, but our panel rendered anyway.
All three such clicks logged `*** MISMATCH — the highlighted load and the panel's load are
DIFFERENT ***`. A dispatcher could read one load's data believing it belonged to another.

**Automated:** `container-suite` (39 checks) + `wiring-suite`. **Live-board status: NOT RUN.**

### Steps

1. `CITY_ASSIGN_DEBUG = true`, `DEBUG_LEVEL = 3`. Reload. Filter the console to `CLICKDIAG`.
2. **Card centre** — click the middle of a load card.
   - Amazon highlights the card, its side sheet updates, our accordion expands.
   - `CLICKDIAG C4 IDS` reports the same id for `highlighted card` and `our panel`, and says
     `match`.
3. **Top edge** — click the first 2-3 px at the top of a card.
   - **Nothing happens.** No panel, no highlight.
   - `CLICKDIAG C2 OURS` says `** THE CARD CONTAINER ITSELF **`.
   - The log carries `click ignored — landed on the card container itself`.
   - **No `*** MISMATCH ***` line appears.**
4. **Bottom edge** — click the last 2-3 px. Same as step 3.
5. **The loop is not disturbed:** if auto-refresh was running before an edge click, it is still
   running after. Only a real card click stops it.

### Expected

| Click | Panel | Amazon highlight | MISMATCH line |
|---|---|---|---|
| centre / any descendant | opens, bound to that load | yes | none — ids match |
| top edge (container) | **none** | none | **none** |
| bottom edge (container) | **none** | none | **none** |

### Fails if

- An edge click still opens the panel — the guard is not reached.
- A **centre** click stops opening the panel — the guard is too wide. **Report it; do not widen or
  narrow the rule.**
- A `MISMATCH` line appears at all — the hazard is still live.

## TC-CITY-IDEMPOTENT — the filter's deadhead substitution writes nothing when nothing changed (2026-08-19)

**Why it exists.** Every filter apply used to remove and re-insert our deadhead `<span>` on every
substituted card. Those are childList mutations, which is exactly what the board MutationObserver
watches, so each apply woke it and the wake re-applied the filter. Measured live on Ihor's board:
24 `removeChild` + 24 `insertBefore` per apply, 20 wakes in 741 ms, unbounded.

**Automated:** `idempotent-suite` (26 checks). **Live-board status: NOT RUN — no browser.**

### Steps — run on a board with at least one MULTI-CITY load (2+ active cities in range)

1. Set `CITY_ASSIGN_DEBUG = true` in `utils/constants.js`, `DEBUG_LEVEL = 3`. Reload.
2. Open the load board with 2+ origin cities selected. Filter the console to `CITYDIAG`.
3. Click a city button. Confirm `CITY DEADHEAD ... inserted N` with N > 0 — the substitution
   happened.
4. **THE TEST:** wait with the board idle and no Amazon re-render.
   - `CITYDIAG Q5 WRITES` for the second apply must show **no `childList` entries** — either
     `** ZERO WRITES **` or attribute-only writes.
   - `CITY DEADHEAD` must read `... substitution(s) ALREADY CORRECT, no DOM write performed`.
   - `CITYDIAG Q6 WAKE` must **stop**, not repeat every 20-25 ms.
   - `CITYDIAG Q56 SUMMARY` must **not** appear — the 20-wake budget is never exhausted.
5. **Rendered result unchanged:** the deadhead figure on each multi-city card reads the same
   before and after, and equals the distance to the SELECTED city (not Amazon's original).
6. **A real change is still written:** switch to another city. `CITY DEADHEAD` must report
   `updated in place N` with N > 0, the figures must change, and no card may still show the
   previous city's number.
7. **Restore:** click the active city again to return to All. Every card must show Amazon's own
   deadhead again, with no `[data-testid="ext-city-deadhead"]` node left in the DOM.

### Expected

| | |
|---|---|
| Second identical apply | zero childList writes; observer does not re-wake |
| Rendered figures | identical to the first apply |
| City switch | values updated **in place**, no node churn |
| Board with no multi-city load | nothing substituted, as before |

### Fails if

- `CITYDIAG Q6 WAKE` keeps firing while the board is idle — idempotence did not close the loop,
  and something else is mutating the observed subtree. **Report it; do not add a loop guard.**
- The deadhead figure changes between two identical applies — the reconcile is not stable.
- Any card shows the previous city's number after a switch — rule 5 broken.

> ## 🔴 OUTSTANDING AS OF 2026-07-31 — run these first
>
> Every change in the 2026-07-31 session was verified by **Node harness only**. No agent has run
> a browser at any point. The six-point smoke checklist in `docs/CLAUDE.md` is **NOT RUN** for
> all of them. These are the live-board passes still owed:
>
> | Test case | Covers | Priority note |
> |---|---|---|
> | **TC-RATELIMIT-7** | Only 429/502/503/504 back off; aborts never reported. **Step 7a covers 502/504**, and step 7 covers 500 which must NOT pause | The 500-vs-502/504 split is deliberate and will look like a bug to anyone who doesn't know |
> | **TC-PARSE-2** | Payout parses in the Similar-matches section. **Step 2** compares the prefilled value against the card's own figure ×1.10 — catches grabbing the *wrong* element, which a non-null check would not. **Step 5** is a known-still-failing gap needing a capture | |
> | **TC-PANEL-2B** | Card click stops auto-refresh even when the refresh detaches the card. **Run at a fast interval (0.5–1s)** — the bug was timing-dependent. **Step 7** re-checks the wrong-panel-data hazard that guard 3 protects | |
> | **TC-CAPTURE-1** | Flag-gated body capture is harmless on a live board. **Step 3 is the whole point** — watch for `TypeError: body stream already read`. Turn **both** `CAPTURE_RESPONSES` flags off afterwards | Nothing may depend on the capture until this passes |
> | **TC-RATELIMIT-6** | The paused/rate-limit sidebar message is gone and pause behaviour survived. **Step 4** (memory tooltip un-clipped) is the specific regression risk | |
> | ~~TC-PANEL-COLOUR-1~~ | **SUPERSEDED** — described the header as `#CFDBFB`, which is no longer true (now `#F5F5F5`), and a 4.48:1 contrast regression that the move has since fixed. Use TC-PANEL-COLOUR-2 | |
> | **TC-PANEL-COLOUR-2** | **Rewritten.** `#F5F5F5` now on `.ext-seg-header`, `.ext-seg-body` back to `#FFFFFF`. **Step 3** is the new risk — the header/body seam is only 1.090:1 and may no longer read as a distinct band | |
> | **TC-FILTERS-1** | Filters panel auto-collapse — **rewritten** 2026-08-05 to a presence test on `div.filters__column`. **Step 2 is the point of the rewrite**: already collapsed must produce *no visual change at all*, no click. **Step 5** verifies the selector assumption itself | Newest feature; clicks Amazon's DOM |
>
> Older outstanding items that predate this session: **TC-RATELIMIT-1** (cross-tab rate limiting
> in a real multi-tab session — a standing pre-launch blocker), **TC-AUTH-8** (activation
> lockout), **TC-AUTH-9** (popup local-first render), and the CSS/UI passes TC-PANEL-WIDTH-1/2
> and TC-PANEL-POLISH-1/2/3.
>
> **TC-RATELIMIT-5 is ⛔ OBSOLETE** — kept verbatim only so it can return if the removed sidebar
> message is ever reinstated.

## Stage 1
- [ ] Loads in chrome://extensions without errors
- [ ] Background logs on install
- [ ] Content logs on Amazon Relay

## Stage 2
- [ ] logger formats correctly
- [ ] debug hidden when DEBUG_LEVEL < 2
- [ ] FORBIDDEN_SELECTORS exported

## Stage 3
- [ ] Sidebar visible, top-center
- [ ] Amazon content not covered
- [ ] Stays fixed on scroll

(continue per stage)

---

## Per-tab state isolation (2026-06-18)

Two relay.amazon.com tabs open simultaneously. All cases verified with both tabs visible.

### TC-TAB-1 — Pause in Tab A does not stop Tab B
1. Start loop in Tab A and Tab B.
2. Click pause in Tab A.
3. **Expected:** Tab A pill shows paused, scanline stops. Tab B pill stays running, scanline continues.

### TC-TAB-2 — Auto-stop after new load in Tab A does not stop Tab B
1. Start loop in both tabs.
2. A new load appears in Tab A — loop auto-stops in Tab A.
3. **Expected:** Tab A pill pauses. Tab B continues running unaffected.

### TC-TAB-3 — Different speeds run independently
1. Set Tab A slider to 1 s, Tab B slider to 5 s.
2. Watch refresh cadence in each tab.
3. **Expected:** Tab A refreshes ~1×/s, Tab B ~1×/5 s. Changing one slider does not change the other.
4. Reload Tab A (memory-reload simulation): after resume, Tab A speed is still 1 s.

### TC-TAB-4 — Surge thresholds are independent; history is per-tab
1. Set sidebar-surge-threshold to $50 in Tab A, $100 in Tab B.
2. Run `__EXT_DEBUG.simulateSurge()` in Tab A with amount=$60.
3. Start loop in Tab A; wait one tick.
4. **Expected:** Tab A surge triggers (60 >= 50). Tab B is unaffected.
5. Run `__EXT_DEBUG.simulateSurge()` in Tab B with amount=$80.
6. Start loop in Tab B; wait one tick.
7. **Expected:** Tab B does NOT trigger (80 < 100).
8. Open chrome://extensions DevTools → `chrome.storage.local.get('priceHistory')` should return `undefined` or `{}` (price history is no longer stored there).

### TC-TAB-5 — Manual memory-indicator reload: loop starts paused, settings restored
1. Set Tab A slider to 3s and surge threshold to $75. Start the loop.
2. Click the `ext-memory-indicator` dot in the Tab A sidebar (or press Enter/Space on it).
3. **Expected after reload:**
   - Tab A loop starts **paused** (pill shows paused, scanline is still).
   - Tab A slider still shows 3s (restored from sessionStorage via `tabState.init()`).
   - Tab A surge threshold still shows $75 (same mechanism).
   - Tab A does NOT auto-resume — the dispatcher must press play manually.
   - Tab B is unchanged throughout.
4. **Confirm no `ext_resume_after_memory_reload` flag:** in Tab A console before clicking the indicator, verify `sessionStorage.getItem('ext_resume_after_memory_reload')` returns `null`. After reload, same check — still `null`.

### TC-TAB-6 — Global settings apply to both tabs
1. In popup: toggle Night Mode on.
2. **Expected:** both Tab A and Tab B switch to dark theme simultaneously.
3. Repeat for Tab Alert, sound volume, tag filters.
4. **Expected:** all global settings propagate to all tabs via chrome.storage.onChanged.

---

## Panel closer fixes (2026-06-18)

### TC-PANEL-1 — Filter panel closes on loop start (FIX 1)
1. On Amazon Relay, open the filter popover (click the Filter button — verify button has `aria-expanded="true"`).
2. Start the loop (click play in the sidebar).
3. **Expected:** filter popover closes immediately; button returns to `aria-expanded="false"`. Loop continues as normal.
4. **Regression check:** start loop when filter popover is NOT open — no error, loop starts normally.

### TC-PANEL-2 — Manual card open stops loop (FIX 2)
1. Start loop in the tab (pill shows running, scanline animates).
2. While loop is running, manually click any load card to open its detail panel.
3. **Expected:** `#selected-work-sheet` opens AND loop stops in this tab (pill shows paused, scanline stops).
4. **Regression check (extension auto-open):** let the loop find a new load and auto-open it — loop ALSO stops (via content.js existing logic), inline panel shows. No double-stop error in logs.
5. **Per-tab isolation:** open two tabs. Stop loop in Tab A via manual card click. Tab B should continue running unaffected.

### TC-PANEL-4 — Clicking card B while card A's sheet is open shows B's data, not A's
1. Click card A. Wait for the inline panel to appear under card A (showing A's route).
2. While A's sheet (`#selected-work-sheet`) is still open, click card B (a different card).
3. **Expected:** the inline panel moves under card B and displays B's route and stops — NOT A's data.
4. **Confirm in logs:** no `waitForSheet` callback fires until the fingerprint changes (payout, expander count, or first stop label changed from A to B). If the timeout fires instead (1500ms), readSheetData reads B's already-loaded sheet.
5. **Regression check:** if A and B happen to have identical payout/expander count/first stop (unlikely), the timeout path still runs and should not render A's data if B's sheet has loaded.

### TC-PANEL-5 — Auto-opened panel can be toggle-closed with one click; old card does not close new panel
1. Start loop. Let auto-open fire on card X. Confirm inline panel appears under card X.
2. **Expected:** `currentPanelCard` now points to card X (set by `showInlinePanel`).
3. Click card X once. **Expected:** panel under card X is removed. Loop stays paused (already paused by auto-stop).
4. Now start loop again. Auto-open fires on card Y (a different card). Panel appears under Y.
5. Click card X (the PREVIOUSLY opened card). **Expected:** nothing happens — card X's click falls through to the toggle-on path (waitForSheet) because `currentPanelCard === cardY ≠ cardX`. Card Y's panel is NOT removed.

### TC-PANEL-3 — Toggle-off card click does not double-stop
1. Start loop. Manually click a card (loop stops, panel appears — TC-PANEL-2 satisfied).
2. Click the same card again to close the inline panel (toggle-off path).
3. **Expected:** panel closes. Loop remains stopped (no redundant start/stop cycle).
4. No errors in console.

---

## MutationObserver instant detection (2026-06-18)

### TC-OBS-1 — Radius (or any) filter change highlights new loads instantly
1. Set timer tick to 6s. Start loop (running = true).
2. Change the radius filter (or any filter param) in the filter panel.
3. **Expected:** new loads highlighted (`.ext-new-load`) within ~200ms — WITHOUT waiting for the 6s tick. Sound alert and tab flash fire if new loads found.
4. **Console confirms (attempt 3):** `DIAG callback: fired` entries appear during filter change, then `DIAG callback: external change while running — debouncing`, then `runObserverPipeline called` within 200ms — WITHOUT waiting for the next tick.

### TC-OBS-2 — Auto-open and auto-stop fire on observer-driven pass
1. Start loop with Auto-Open enabled.
2. Change filter so a new load appears.
3. **Expected:** top new load card opens (detail sheet + inline panel) AND loop stops (pill shows paused) — same behaviour as timer tick with new loads. Loop was stopped by `tabState.set('running', false)` in `runObserverPipeline`.

### TC-OBS-3 — No infinite observer loop from ext DOM mutations
1. Start loop. Let it find a new load and render the inline panel (highlight + badge + panel insertion).
2. **Expected:** no second pipeline pass fires as a result of the inline panel insertion or highlight class addition. Console shows "ext-managed change only — ignored" for the panel insert mutation.
3. Confirm: no duplicate sound, no double auto-open, no console error loop.

### TC-OBS-4 — Observer stops on pause; restarts on resume
1. Start loop, confirm observer is active (logs "observer active on first div.load-list").
2. Pause loop (click pause pill).
3. Change a filter. **Expected:** no pipeline pass fires (observer disconnected or running-gated).
4. Resume loop. **Expected:** observer reconnects; filter change again triggers detection.

### TC-OBS-5 — Observer is clean after manual memory-indicator reload
1. Click `ext-memory-indicator` in the sidebar to trigger a reload (no sessionStorage flag is set).
2. **Expected after reload:** loop starts paused; observer is NOT connected (observer connects only when loop is running). No stale callbacks from before reload.
3. Press play. **Expected:** observer connects and begins watching for DOM changes normally.
4. Confirm no `ext_resume_after_memory_reload` key exists in sessionStorage at any point.

---

## Inline panel stop numbers (2026-06-18)

### TC-STOP-1 — Global stop numbers appear in stop-detail table
1. Start loop. Let auto-open fire on a multi-segment load (≥ 2 legs).
2. Expand one segment's stop-detail accordion.
3. **Expected:** each address row has a blue `.ext-stop-num` circle showing the global stop number.
   - Segment 0 rows: circles "1" and "2".
   - Segment 1 rows: circles "2" and "3" (2 is shared with segment 0's destination).
   - Segment 2 rows: circles "3" and "4" (3 is shared with segment 1's destination).
4. **Regression check (single-segment load):** circles "1" and "2" appear.

### TC-STOP-3 — Segment with 3 stops: continuous numbering, no duplicates in next segment
1. Find or simulate a load with a segment that has 3 stops (e.g., pickup + mid-stop + delivery).
2. Open the inline panel. Expand all segments.
3. **Expected stop numbering (example: seg0=3 stops, seg1=2 stops, seg2=2 stops):**
   - Segment 0: stop circles "1", "2", "3"
   - Segment 1: stop circles "3", "4"  ← "3" shared with seg 0's last stop
   - Segment 2: stop circles "4", "5"  ← "4" shared with seg 1's last stop
4. No duplicate number appears more than twice (boundary stops only).
5. **Regression (2-stop segments):** original documented example still produces 1,2/2,3/3,4 for three 2-stop segments.

### TC-STOP-2 — Shared stop has identical number in both segments
1. Open a 3-segment load's inline panel.
2. Expand segment 0 and note the destination stop number (e.g., "XBN6 → 2").
3. Expand segment 1 and note the origin stop number.
4. **Expected:** both show the same number ("2"). Stop numbering is continuous, not per-segment restarted.

---

### TC-OPEN-1 — Auto-open targets highest-paying new load, not DOM-first
1. Arrange the load board so card A ($250, first in DOM) and card B ($480, second in DOM) both appear as new loads in the same tick.
2. Start the loop. When the tick runs and detects both, **Expected:**
   - Both cards receive `.ext-new-load` highlight (order irrelevant).
   - The detail panel opens for card B ($480 — higher payout), not card A.
   - The inline panel renders under card B.
3. Confirm in logs: `runDetectionPipeline: inline panel shown` with `topPayout: "$480.xx"` (or the actual higher value).

### TC-OPEN-2 — Card detach during 250ms settle: no click fires, no error
1. Start loop. When auto-open fires (a new load is found), immediately change a filter in Amazon's filter panel so that Amazon React unmounts and remounts the load list within the 250ms scroll-settle window.
2. **Expected:** console shows `detailOpener: element detached during scroll settle — NOT clicking`. No `.click()` fires. No console error. Loop is already paused (auto-stopped before the click was scheduled).
3. **Regression check:** normal tick with stable DOM — card remains attached, click fires as expected.

### TC-PARSE-1 — Highlighted card produces no null-loadId duplicate
1. Open the load board and let Amazon highlight a card (`.wo-card-header--highlighted` applied to an inner header inside a `.load-card`).
2. Run `__EXT_DEBUG.getLoads()` in the console.
3. **Expected:** each load appears exactly once in the returned array. No entry with `loadId: null` is present. No `loadParser: failed to parse card` error appears in the console for the highlighted card.
4. Confirm in logs: if any nested elements were filtered, `dropped nested card matches` debug line appears with `dropped: N` (N ≥ 1).

### TC-LOOP-1 — Rapid play→pause→play does not start parallel loops
1. Start loop (play). Immediately click pause then play again, all within 1 second.
2. **Expected:** exactly one loop chain runs. Only one refresh fires per interval. Only one sound plays per new load batch. Pause fully stops the loop (no "ghost" tick continues).
3. **Confirm in logs:** `startOrchestrator: loop already active — ignoring` appears on the second play while the first tick is still in-flight. `orchLoopActive` is set before the first tick, so the second call hits the guard immediately.

### TC-STORE-1 — LoadUnit detail data survives transient empty render during filter change
1. Start loop. Let auto-open fire for a load — this triggers Phase 2 (`showInlinePanel`), which merges `detail` into the LoadUnit. Confirm via console: `__EXT_DEBUG.getLoadUnits()` shows the load with a non-null `detail` field.
2. Change an Amazon search filter (e.g., radius slider). Amazon React unmounts and remounts the load list, which may briefly show 0 cards.
3. Change the filter back to restore the same load.
4. **Expected:** `__EXT_DEBUG.getLoadUnits()` still shows the load with its `detail` field intact. The transient 0-card render did NOT trigger `pruneLoadUnits` (logs show "skipping pruneLoadUnits (transient empty render)").
5. **Regression check:** when a load genuinely disappears (filter excludes it permanently), it IS eventually pruned — confirmed after the next parse that returns ≥1 card.

### TC-OBS-6 — Back-to-back observer + timer tick: no duplicate alert
1. Start loop with timer interval = 2s.
2. At t=0, a filter change triggers the observer; observer runs at t=200ms (debounce). Finds 0 new loads.
3. At t=2000ms, timer tick runs. Also finds 0 new loads.
4. **Expected:** only ONE detection pass' worth of behaviour — no duplicate sound, no double highlight. `detectNewLoads` idempotency confirmed.

---

## Memory indicator (2026-06-30)

## Popup / sound (2026-07-03)

### TC-POPUP-1 — Auto-Open OFF: highlights and sound fire, but no card opens
1. Open popup → toggle **Auto-Open Top Load** OFF.
2. Start loop. Wait for a new load to appear.
3. **Expected:**
   - Cards with `.ext-new-load` highlight appear (highlighting always fires).
   - Sound plays (alert always fires).
   - Tab title flashes if Tab Alert is ON.
   - Loop auto-stops (tabState running → false).
   - NO detail card opens (`openTopNewLoad` is not called).
   - NO inline panel renders under any card.
4. **Reset check:** open popup, click Reset to defaults → Auto-Open toggle returns to **ON** (true-default).

---

## PAT modal (2026-07-07)

### TC-PAT-1 — Create Post on a freshly loaded page with the loop never started
1. Load `relay.amazon.com` (fresh page load or hard reload).
2. Do NOT press Play in the sidebar. The loop has never run; `parseLoads()` has never been called.
3. Click any load card that shows a "53' Trailer" to open its detail sheet.
4. Wait for the inline panel to appear below the card (manual toggle path, `waitForSheet` callback fires).
5. Click the `ext-action-post` button (document icon).
6. **Expected:**
   - In the console: `ext-action-post: Phase 1 missing — parsing card on demand` log line; also logs `usedLive: true` (live DOM node resolved via `getElementById`) and `sameNode` (`true` when the live outermost node is the same element as the captured `cardElement`; `false` when card nesting caused `initManualToggle` to capture an inner node — this is the scenario `findLiveOutermostCard` corrects).
   - The PAT modal opens immediately.
   - Origin and destination city name areas show the board stop codes (pre-parse placeholder), then switch to resolved city names as the API call completes.
   - Payout field shows `boardPayout + 5000` (a large number, not $0 or blank).
   - $/mi and min/max miles are computed from `distance`.
   - Equipment shown in the summary row matches the card's equipment text.
   - No "Could not read load data" error; no "unsupported equipment" error.
7. **Regression check (loop running):** start the loop, let a card auto-open. Click `ext-action-post`. Expected: `ext-action-post: Phase 1 missing` log does NOT appear (Phase 1 was already populated by `parseLoads()`). Form opens with the same data.
8. **Edge case — card layout unexpected:** if `parseOneCard` returns empty equipment (selector `.equipment-type-text` absent or different), expected:
   - `ext-action-post: on-demand parse yielded empty Phase 1` error log with `outerHTMLLen` and `loadId`.
   - Modal opens showing "Could not read load data from this card — start the refresh loop once, or report this card layout to the PM." (testid `pat-no-equipment`).
   - No network request is made.

### TC-PAT-2 — Distance > 1000 mi: MIN/MAX compute correctly with comma in distance string
1. Open the inline panel for a load whose board distance shows `"1,233.2 mi"` (or any value with a thousands-comma).
2. Click `ext-action-post`.
3. **Expected:**
   - MIN miles field = `Math.round(1233.2) - 25` = **1208**
   - MAX miles field = `Math.round(1233.2) + 25` = **1258**
   - $/mi = `initPayout / 1233.2` (rounded to 2 decimals)
4. **Regression check (< 1000 mi, e.g. "104.0 mi"):** MIN = 79, MAX = 129 — unchanged.
5. **Failure signature before fix:** `distMiles = 1` (parseFloat stops at comma) → MIN = 0, MAX = 26.

### TC-PAT-3 — Payout rounding: no trailing float noise anywhere
1. Open ext-action-post for any load whose `payoutNum` produces a float-arithmetic imprecision (e.g. `boardPayout = 2279.86` → `2279.86 + 5000 = 7279.860000000001` raw float).
2. **Expected in the Payout ($) field:** `"7279.86"` — exactly two decimals, no `"7279.860000000001"`.
3. **Expected in the console logger** (`modal rendered` entry): `initPayout: 7279.86` — the variable itself is rounded, not just the field.
4. Change the $/mi field and change it back. **Expected:** Payout field remains `"7279.86"` (listener also applies `.toFixed(2)`).

### TC-PAT-4 — boardStops with full state name prefixed before city
1. Simulate a boardStops entry `"ILL1 Illinois AURORA, IL 60505"` (open `ext-action-post` on a card whose origin has this entry, OR call `parseBoardStop("ILL1 Illinois AURORA, IL 60505")` directly in the console).
2. **Expected result:** `{ city: "AURORA", state: "IL" }`.
3. **Regression — normal entry:** `parseBoardStop("DNA4 MEMPHIS, TN 38128-2510")` → `{ city: "MEMPHIS", state: "TN" }` unchanged.
4. **Regression — multi-word city starting with state-ish word:** `parseBoardStop("XYZ1 NORTH LITTLE ROCK, AR 72117")` → `{ city: "NORTH LITTLE ROCK", state: "AR" }` (no stripping — "north little rock" does not start with any state name + space).

### TC-PAT-5 — Dotted abbreviation in city triggers API retry with expanded name
1. Simulate a boardStops origin entry `"TNK1 MT. JULIET, TN 37122"`.
2. **Expected flow in console:**
   - First fetch: `GET /api/loadboard/filters/cities/search/MT.%20JULIET` — attempt primary + fallback match.
   - If no match: log line `resolvePATCity: retrying with expanded abbrev { from: "MT. JULIET", to: "MOUNT JULIET" }`.
   - Second fetch: `GET /api/loadboard/filters/cities/search/MOUNT%20JULIET` — primary match on `"MOUNT JULIET, TN"`.
3. **Expected modal:** origin city resolves to `"MOUNT JULIET, TN"`.
4. **No retry when no abbreviation:** city `"MEMPHIS"` — no second fetch is issued (`expandedCity === city`, condition false).
5. **ST. / FT. variants:** `"ST. LOUIS, MO"` → retry with `"SAINT LOUIS, MO"`; `"FT. WAYNE, IN"` → retry with `"FORT WAYNE, IN"`.

### TC-PAT-6 — Abbreviated board city name resolves via prefix+subsequence fallback
1. Simulate a boardStops entry `"NJC1 BURLNGTN TWP, NJ 08016"` (or use a real card with that board text).
2. Click `ext-action-post`. Watch the console.
3. **Expected console sequence:**
   - `resolvePATCity: retrying with expanded abbrev` — NOT logged (no dotted abbreviation in "BURLNGTN TWP").
   - `resolvePATCity: trying prefix+subsequence fallback { city: "BURLNGTN TWP", prefix: "BURL", state: "NJ" }`
   - Second GET: `/api/loadboard/filters/cities/search/BURL`
   - `resolvePATCity: prefix+subsequence matched { city: "BURLNGTN TWP", matched: "BURLINGTON TWP", state: "NJ" }`
4. **Expected modal:** origin city shows `"BURLINGTON TWP, NJ"`.
5. **No-guess case (ambiguous):** if more than one NJ city starting with "BURL" passes the subsequence check, expected log: `ambiguous prefix+subsequence — not guessing { count: N, names: [...] }` and origin city shows the "Could not resolve city" error.
6. **No-guess case (zero candidates):** no NJ city starting with "BURL" passes subsequence check → same "Could not resolve" error.
7. **Regression — normal city name:** `"DNA4 MEMPHIS, TN 38128-2510"` → primary match finds "MEMPHIS, TN" directly; prefix+subsequence fallback is never reached.
8. **`isSubseq` correctness:**
   - `isSubseq("BURLNGTNTWP", "BURLINGTONTWP")` → `true` (all 11 abbrev chars found in order)
   - `isSubseq("BURLNGTNTWP", "BURLINGTON")` → `false` (10 chars in full, can't absorb TWP)
   - `isSubseq("BURLNGTNTWP", "BURLINGTONHEIGHTS")` → `false` (no T,W,P after consuming the middle chars)

### TC-SOUND-1 — Popup preview and in-page alert produce identical tones for the same soundId
1. In the popup, select a sound (e.g. "Fanfare") and click the replay button.
2. Let the extension play an in-page alert for the same soundId (manually trigger via `__EXT_DEBUG.playAlert()` in the content console, with `soundId = 'fanfare'`).
3. **Expected:** the two sounds are audibly identical — same pitch sequence, same timing, same waveform. Both use `SOUND_DEFS['fanfare']` from the shared `utils/soundDefs.js` global.
4. Repeat for two more sounds (e.g. "Alarm siren" and "Rising sweep") to confirm no divergence.

---

## Memory indicator (2026-06-30)

### TC-MEM-1 — Indicator polls while paused, click reloads, tooltip warns about filters
1. Load extension. Keep loop **paused** (do not press play).
2. Wait ~7s. **Expected:** `ext-memory-indicator` dot color updates (reflecting current heap ratio), with no ticker/sound — indicator polls independently of loop state.
3. Hover (or focus) the `ext-memory-info` "i" icon. **Expected:** `ext-memory-tooltip` appears and text includes a warning that Amazon search filters will need to be re-entered after reload (via `textContent`; no innerHTML).
4. Click the `ext-memory-indicator` dot (or press Enter/Space). **Expected:** page reloads immediately. No confirmation dialog. No sessionStorage flag set before reload.
5. After reload: loop is paused. Speed and surge threshold restored from sessionStorage. Dispatcher presses play manually to resume.
6. **Regression check (running state):** start the loop and let it run. The dot still updates every ~7s. Clicking it still reloads. The running state is NOT preserved across the reload — loop starts paused after reload regardless.

---

## Popup login — pending state + login gating (2026-07-20)

### TC-AUTH-1 — Popup reopen during pending code restores the code step
1. In the popup, enter an email and click "Send code" (`popup-auth-send-code`). **Expected:** step advances to `popup-auth-step-code`, status shows "Code sent to …".
2. Close the popup **without** entering the code (click elsewhere on the page, or press Escape).
3. Reopen the popup. **Expected:** the popup shows `popup-auth-step-code` directly (not the email step) — `popup-auth-email` is pre-filled with the same address, and `popup-auth-status` shows "Enter the code sent to …". No new code was sent.
4. Enter the correct code and click "Verify" (`popup-auth-verify`). **Expected:** logged-in state shown; reopening the popup again now shows the logged-in step (`popup-auth-step-loggedin`), not the code step — pending state was cleared on successful verify.
5. **Regression — "Use different email" clears pending state:** repeat steps 1–2, reopen the popup (confirms code step restores), then click "Use different email" (`popup-auth-change-email`). **Expected:** returns to the email step. Reopen the popup once more — **expected:** email step again, not the code step (pending state was cleared, not just hidden).
6. **Regression — normal path unaffected:** send a code and verify it in the same popup session without closing. **Expected:** works exactly as before this change.

### TC-AUTH-2 — Logged-out state disables extension features but leaves the page untouched
1. Ensure logged out (click "Log out" in the popup if currently logged in, or use a fresh profile with no session).
2. Load (or reload) `relay.amazon.com`. Open the browser console.
3. **Expected console:** `[EXT][...][content] auth gate closed — extension inactive on this page load`. No sidebar (`ext-sidebar`), no inline panel, no Night Mode, no tag-filter hiding, no "Hide Similar Matches" — none of our `data-testid` elements exist anywhere in the DOM (`document.querySelector('[data-testid^="ext-"]')` → `null`, `document.querySelector('[data-testid^="popup-"]')` is popup-only so N/A here).
4. **Expected page behavior:** the Load Board itself works completely normally — cards render, Amazon's own filters/search/refresh/booking all function exactly as they would with the extension uninstalled. No visual difference from the unmodified page (Night Mode was never applied, `html.ext-night` is absent).
5. Open the popup. **Expected:** email step shown (or code step, per TC-AUTH-1) with `popup-auth-gate-note` visible: "Free access — sign in with your email to activate Torren Relay". See TC-AUTH-4 for the full login-only-view check.
6. Complete login (send code, verify). **Expected (updated 2026-07-20 — see TC-AUTH-6 for the detailed version):** the already-loaded Relay tab activates **immediately, no reload** — sidebar appears, `[EXT][...][content] activateExtensionUI called` logged. This used to require a reload; live reactivation was added 2026-07-20 (`utils/authGate.js` `onAuthGateChange`).
7. **Regression — logout while a tab is active:** with the loop running in a Relay tab, log out via the popup. **Expected (updated 2026-07-20):** the loop stops and the sidebar/inline panel/highlights are removed immediately, no reload — see TC-AUTH-6.

### TC-AUTH-3 — Session expired but refresh token valid refreshes silently, does not log out
1. Log in normally. In the browser console (extension popup or content-script context), locate the stored session (`chrome.storage.local.get('supabaseSession', console.log)`) and note `expires_at`.
2. Simulate near-expiry by editing the stored session's `expires_at` to `Math.floor(Date.now()/1000) + 10` (10 seconds out — inside the 30s buffer) via `chrome.storage.local.set({ supabaseSession: {...} })` in the console, keeping the real `refresh_token`.
3. Reopen the popup (or reload the Relay tab). **Expected:** no login form shown — the session is silently refreshed (`auth.refreshSession()` called under the hood), a new `expires_at` further in the future is written back to `chrome.storage.local`, and the logged-in state / sidebar appears normally. Console shows a refresh log line (`restoreSession: refreshing expired session` in the popup, or `authGate: session expiring — refreshing silently` in the content script) — **not** a logout.
4. **Regression — genuinely invalid refresh token:** repeat with a deliberately corrupted `refresh_token` (e.g. append garbage characters). **Expected:** popup falls back to the email/pending-code step (`restoreSession` catch clears the session); a content-script tab in this state logs `auth gate closed` and does not activate. This is the one case where the stored session IS cleared — by the popup only, never by a content script (see utils/authGate.js header comment).

### TC-AUTH-4 — 8-digit code accepted; code field validates digits-only, not a fixed length
1. Trigger a real "Send code" in the popup. **Expected:** Supabase emails an 8-digit numeric code (current default OTP length for this project).
2. Enter the 8-digit code into `popup-auth-code`. **Expected:** the full 8 digits are accepted — the field does not truncate at 6 characters (`maxlength="10"`), and clicking "Verify" (`popup-auth-verify`) succeeds.
3. **Label check:** the code step shows a label reading "Code from email" directly above the input (`<label for="popup-auth-code">`).
4. **Regression — too short:** enter a 5-digit value and click Verify. **Expected:** rejected client-side with "Code must be 6-10 digits, numbers only." — no `verifyOtp` call made (check the console: no `[EXT][...][popup] verifyOtp` log line).
5. **Regression — too long:** attempt to enter an 11-digit value. **Expected:** the input itself stops accepting characters past 10 (`maxlength="10"`); if 10 non-matching-code digits are submitted anyway, `verifyOtp` is called and fails server-side (not a client-side validation gap — 10 is the accepted upper bound per the spec).
6. **Regression — non-digit characters:** paste a value containing letters or symbols (e.g. "12a456"). **Expected:** rejected client-side with the same "digits only" error message; no `verifyOtp` call made.
7. **Regression — 6-digit codes still work:** if a different Supabase project configuration ever sends 6-digit codes, entering exactly 6 digits and clicking Verify **Expected:** succeeds — the validation range is 6–10 inclusive, not "8 only".

### TC-AUTH-5 — Email field is unrestricted; email and code inputs are fully independent elements
1. On a fresh popup open (logged out, email step), click into `popup-auth-email` and type a full, realistic address, e.g. `dispatcher.name+test@example-carrier.com` (36 characters, includes letters, dots, `+`, `-`, `@`).
2. **Expected:** every character is accepted — no truncation, no rejection of letters/symbols. `popup-auth-email` is `type="email"` with no `maxlength` and no digit `pattern`; it is a **separate DOM element** from `popup-auth-code` (confirmed 2026-07-20: distinct `id`s, distinct `data-testid`s, distinct parent steps `popup-auth-step-email` / `popup-auth-step-code`, mutually exclusive via the `hidden` attribute with no CSS override).
3. Click "Send code". **Expected:** `signInWithOtp` is called with the exact address typed (check the console log line `[EXT][...][popup] signInWithOtp { email: "..." }`) — no digit-stripping, no truncation to 10 characters.
4. Enter the received code (per TC-AUTH-4) into `popup-auth-code` and click Verify. **Expected:** login succeeds end-to-end — this is the full round trip (realistic email in → code in → logged-in state), not just the two fields tested in isolation.
5. **Regression — standard email format validation only:** typing an invalid address (e.g. `notanemail`) and clicking "Send code" **Expected:** whatever the current empty/format check produces (as of 2026-07-20, only an empty-value check — `if (!email) { setAuthStatus('Enter your email.', true); ... }` — the browser's native `type="email"` constraint is not additionally enforced via `checkValidity()`). This case exists to catch any future regression that accidentally imports the code field's digits-only regex onto the email field, which must never happen.

### TC-POPUP-GATE-1 — Logged-out popup shows only the login block
1. Ensure logged out. Open the popup.
2. **Expected:** visible — `popup-section-title` "Account", `popup-auth-gate-note` reading "Free access — sign in with your email to activate Torren Relay" (styled as a headline, not a small note), and the email-step form (`popup-auth-step-email`: `popup-auth-email` input + `popup-auth-send-code` button).
3. **Expected hidden (`popup-features` container, `hidden` attribute set):** "Display & Alerts" section title and everything under it — `popup-night-mode`, `popup-tab-alert`, `popup-auto-open`, the entire Sound block (`popup-volume`, `popup-sound-select`, `popup-sound-replay`), `popup-surge` + `popup-surge-threshold`, "Load Board Filters" section (all four tag toggles + `popup-hide-similar`), "Booking" section (`popup-fast-book`), and the `popup-reset` footer link. None of these should be visible or reachable by scrolling.
4. Click "Send code", then reopen the popup mid-flow. **Expected:** still only the login block (now on the code step) — `popup-features` remains hidden throughout the email and code steps, not just the initial email step.
5. Complete login (verify a valid code). **Expected:** `popup-auth-gate-note` disappears, `popup-auth-step-loggedin` shows (email + Log out) at the top, and immediately below it every control listed in step 3 reappears and is fully interactive (toggle Night Mode, adjust volume, etc. — confirm at least 2–3 controls actually respond).
6. Click "Log out". **Expected:** back to step 2's exact state — login-only view, all feature controls hidden again.

### TC-PAT-MARKUP-1 — Default Payout is board payout × 1.10, not board payout + $5000
1. Open a load card with a clear, parseable payout (e.g. board shows "$2,000.00"). Click `ext-action-post`.
2. **Expected:** once the modal renders (and, if applicable, once city resolution completes), `ext-pat-payout` defaults to `2200.00` (2000 × 1.10, rounded to 2 decimals) — not `7000.00` (the old flat +$5000 behavior).
3. **Expected:** `ext-pat-permile` defaults to `2200.00 / distMiles` (board distance), consistent with the new payout, not the old one.
4. Edit `ext-pat-payout` to a different value (e.g. `3000`). **Expected:** `ext-pat-permile` updates live via the existing $/mi ↔ payout linkage — unaffected by this change, still fully editable.
5. **Regression — rounding:** use a payout that doesn't round cleanly, e.g. board payout `$1,234.56` → expected default Payout `1358.02` (`1234.56 × 1.10 = 1358.016` → rounds to `1358.02`).

### TC-PAT-MARKUP-2 — Missing/unparseable board payout blocks Confirm, no silent fallback
1. Force a load card into a state where payout can't be read — e.g. via `window.__EXT_DEBUG` or by testing a card where `.wo-total_payout` is absent (matches the existing `payoutNum === null` fallback path already logged by `openPostModal`). Click `ext-action-post`.
2. **Expected:** `ext-pat-payout` renders **empty** (not `"0.00"`, not any other default) and `ext-pat-permile` also renders empty.
3. **Expected:** `ext-pat-payout-warning` is visible, directly under the Payout field, reading exactly: "Board payout could not be read — enter payout manually".
4. **Expected:** `ext-pat-confirm` stays disabled even after city resolution completes successfully (both origin and destination resolve cleanly) — confirm this by watching the console for the city-resolution success path and checking `ext-pat-confirm.disabled === true` immediately after.
5. Type a valid positive number into `ext-pat-payout` (e.g. `1500`). **Expected:** `ext-pat-payout-warning` disappears immediately (live, on `input` event — no need to blur/tab away), and `ext-pat-confirm` becomes enabled (assuming cities already resolved and no other blocking errors like unknown loading type or bad timezone).
6. Clear the field back to empty, or enter `0` or a negative number. **Expected:** `ext-pat-payout-warning` reappears and `ext-pat-confirm` disables again — the gating is fully live/bidirectional, not just a one-time check at render.
7. **Regression — normal case unaffected:** repeat TC-PAT-MARKUP-1 with a normal parseable payout. **Expected:** `ext-pat-payout-warning` never appears, Confirm enables normally once cities resolve (unchanged from before this fix).
8. **Regression — Confirm-click safety net:** with the warning showing (Payout still empty) somehow bypass the disabled button (e.g. via `__EXT_DEBUG` or DevTools) and click Confirm anyway. **Expected:** the existing `if (isNaN(payoutVal) || payoutVal <= 0)` check in the confirm handler still fires "Payout must be a positive number." and does not submit — the disabled-button gating and the click-handler validation are independent, redundant safeguards.

### TC-AUTH-6 — Login/logout via the popup activates/deactivates an already-open Relay tab, no reload

**Not yet run — no browser available in the environment that implemented this. Run this exact sequence before considering the feature verified.**

1. Log out (via the popup, if currently logged in). Load `relay.amazon.com` in a tab and leave it open. Open that tab's DevTools console.
2. **Expected (baseline, unchanged from TC-AUTH-2):** no `ext-sidebar`, no inline panel — page is untouched. Console shows `auth gate closed — extension inactive on this page load`.
3. Without closing or reloading that tab, open the extension popup (same window or a different one) and complete login (send code, enter the code, Verify).
4. **Expected in the already-open Relay tab's console**, within roughly a second of Verify succeeding: `[EXT][...][authGate] session storage changed — rechecking gate`, then `[EXT][...][authGate] gate transition { from: false, to: true, email: "…" }`, then `[EXT][...][content] activateExtensionUI called`.
5. **Expected visually in that tab, no reload:** `ext-sidebar` appears at the top of the page (title, play/pause pill, speed slider, memory indicator). If Night Mode was toggled on in the popup before this test, `html.ext-night` and the dark styling should also apply live. If any "Hide Similar Matches" / tag-filter toggles were on, those should also take effect live.
6. Click the sidebar's play/pause to start the loop. **Expected:** works exactly as it would after a fresh logged-in page load — detection runs, cards highlight, etc.
7. Open a load card's inline panel (manual click). **Expected:** panel opens normally.
8. Without closing or reloading the tab, log out via the popup.
9. **Expected in the Relay tab's console:** `gate transition { from: true, to: false, email: null }`, then `[EXT][...][content] deactivateExtensionUI called`, then `extension UI deactivated — page reverted to untouched state`.
10. **Expected visually, no reload:** `ext-sidebar` is completely removed from the DOM (`document.querySelector('[data-testid="ext-sidebar"]')` → `null`). The inline panel from step 7 is also removed. Any highlighted new-load cards and any Night Mode / tag-filter styling revert — the page looks exactly as it did in step 2. If the loop was running (step 6), it has stopped (no further console ticks).
11. **Regression — repeat the full login→logout cycle 3 times in the same tab without reloading.** Expected: behaves identically each time — sidebar appears/disappears cleanly, no duplicate sidebars, no visually-doubled scanline/memory-indicator animation, no growing console log volume per cycle. This specifically checks the `tabState.unsubscribe()` / `clearInterval()` cleanup added alongside this feature — without it, each cycle would leak one more permanent `tabState` subscriber and one more orphaned `setInterval`, both invisible in normal use but detectable via repeated cycling.
12. **Regression — the manual card-click listener respects the live gate too:** while logged out (post step 10), click a load card directly. **Expected:** nothing happens — no panel opens. This confirms `initManualToggle()`'s one-time-registered click listener is checking `isAuthGateActiveSync()` on every click, not just relying on the sidebar's absence.

### TC-PAT-CITY-1 — Empty-city resolution failure shows the specific message, doesn't discard a resolving sibling

Regression test for the `boardStopStr`-undefined crash fixed 2026-07-20 (found via the
read-only logic audit). Logic-level fix confirmed via a Node `vm` harness (no DOM/network
needed — see CHANGELOG.md); this test case is the still-outstanding real-browser check.

1. Open a load whose origin or destination city will parse down to an empty string — e.g. a
   board stop string that is only a station code with no city text after stripping (`"DNA4"`
   with nothing following), or force it via `window.__EXT_DEBUG` / DevTools by calling
   `resolvePATCity('')` directly in the console first to sanity-check step 2 before trying
   the full modal.
2. Click `ext-action-post` to open the PAT modal.
3. **Expected — this is the regression:** `ext-pat-status` shows a **specific** message:
   `Could not resolve city: «, » — check logger output` (or similar, with whatever
   city/state text was actually parsed) — **not** the generic `City resolution error — check
   logger output`. Confirm via the console that `[EXT][...][patApi] resolvePATCity: empty
   city from parseBoardStop { input: ... }` was logged, with a real `input` value (not
   `undefined`), and that no uncaught `ReferenceError` appears in the console.
4. **Expected — sibling not discarded:** if only ONE of origin/destination has the
   empty-city problem, the OTHER one still resolves and displays its city name normally
   (`ext-pat-origin` or `ext-pat-dest`, whichever is the working one, shows "CITY, ST" with
   `.resolving` class removed) — it must not also show an error or stay stuck on "resolving…"
   just because its sibling failed.
5. **Expected:** `ext-pat-confirm` stays disabled (city resolution failure is one of the
   existing blocking conditions — unchanged behavior).
6. **Regression — normal case unaffected:** open a load where both cities resolve
   successfully. **Expected:** works exactly as before this fix — both city names display,
   Confirm enables once other conditions are met.

### TC-PAT-TIME-1 — Missing/unparseable load time blocks Confirm and shows a warning; manual entry unblocks it

Regression test for the fabricated-time silent fallback fixed 2026-07-20 (found via the
read-only logic audit). `makeTimeStepper()`'s core logic was verified via a Node `vm`
harness (no DOM/network needed — see CHANGELOG.md); this test case is the still-outstanding
real-browser check of the full modal.

1. Open a load whose first or last stop has a missing or unrecognized-format arrival time
   (`parsePatStopTime()` returns `null` — not a `tzError`, which is the separate,
   already-covered case below). If none is available live, simulate via
   `window.__EXT_DEBUG` / DevTools, or temporarily blank a stop's arrival text.
2. Click `ext-action-post` to open the PAT modal.
3. **Expected — this is the regression:** the affected stepper (`ext-pat-start` and/or
   `ext-pat-end`) shows "Not set — click to enter" instead of a plausible-looking time. It
   must **not** show a time computed from the current wall-clock (e.g. roughly "now" or "now
   + a few hours") — that was the bug.
4. **Expected:** the `±` step buttons on the affected stepper are disabled (nothing to step
   from yet). The manual-entry date/time picker is visible immediately under it (not hidden
   behind a click, since there's nothing to display).
5. **Expected:** `ext-pat-times-warning` is visible: "Load times could not be read — enter
   start/end time manually".
6. **Expected:** `ext-pat-confirm` stays disabled even once both cities resolve successfully
   and Payout holds a valid value — confirm this by checking `ext-pat-confirm.disabled ===
   true` after city resolution completes.
7. Enter a valid date/time into the affected picker. **Expected, live, no other interaction
   needed:** `ext-pat-times-warning` disappears immediately, the stepper now shows the
   entered time and its `±` buttons re-enable, and `ext-pat-confirm` becomes enabled
   (assuming cities are resolved and Payout is valid — this is the "manual entry unblocks
   it" requirement).
8. Clear the picker back to empty. **Expected:** `ext-pat-times-warning` reappears and
   `ext-pat-confirm` disables again — the gating is live/bidirectional in both directions,
   not a one-time check.
9. **Regression — Confirm-click safety net:** with the warning showing, bypass the disabled
   button (e.g. via DevTools) and click Confirm anyway. **Expected:** "Enter both start and
   end time — cannot submit." fires and nothing is submitted — same redundant-safeguard
   pattern as the other fields (Payout, Min/Max Miles, city resolution).
10. **Regression — tzError case unaffected in behavior, only in stepper display:** open a
    load with an unrecognized timezone abbreviation in the arrival text. **Expected:**
    `ext-pat-status` still shows the specific "Unrecognized timezone: «X» in start/end time"
    message (unchanged), and Confirm remains **permanently** disabled for this modal instance
    even if a time is manually entered afterward (tzError stays in the static
    `blockingErrors` list, per "leave tzError handling as-is") — only the stepper's own
    visual now shows "Not set" instead of a fabricated time, which is expected since the
    shared fallback was removed entirely.
11. **Regression — normal case unaffected:** open a load where both stop times parse
    normally. **Expected:** works exactly as before this fix — both steppers show the real
    time immediately, `±` buttons work, no warning, Confirm enables once other conditions
    are met.

### TC-AUTH-7 — Logout mid-tick leaves no extension DOM behind

Regression test for the in-flight-tick-outlives-logout bug fixed 2026-07-20 (found via the
read-only logic audit; complements TC-AUTH-6, which covers the non-racy activate/deactivate
path). `shouldContinue()`'s bail-out logic was verified via a Node `vm` harness simulating
the exact timing (see CHANGELOG.md); this test case is the still-outstanding real-browser
check, and the hardest of the auth test cases to land deliberately by hand since it depends
on timing a logout to hit one of two narrow windows in a live tab.

1. Log in. On a Relay tab with real new loads available (or loads likely to trigger Auto-Open
   Top Load / Price Surge — enable both in the popup beforehand to widen the window), start
   the loop (Play).
2. **Target window A (~1.2s):** the moment right after the sidebar's refresh countdown fires
   — this is `REFRESH_SETTLE_MS`, the gap between `refreshNow()` and the detection pass in
   `orchestratorTick`. Log out via the popup as close to that moment as you can.
3. **Target window B (~800ms, the exact scenario from the bug report):** watch the console
   for `runDetectionPipeline: inline panel shown` (or the surge variant) — if you can log out
   in the ~800ms gap between a new load being detected/highlighted and that log line
   appearing, you've hit the exact window the bug lived in. Since this is hard to time by
   hand, try it across several ticks/reloads of the page until you land in the window at
   least once — the console log lines added by this fix
   (`runDetectionPipeline: bailing — gate/running closed { checkpoint: ... }`) make it
   obvious when you have, even if the visual difference is subtle.
4. **Expected, for either window, once you land in it:** the console shows a `bailing —
   gate/running closed` log line naming the checkpoint it caught at. No inline panel
   appears. No card is left highlighted (`.ext-new-load`). No surge badge
   (`ext-surge-badge`)/highlight (`.ext-surge-price`) appears. `ext-sidebar` is fully removed
   from the DOM (same as TC-AUTH-6) — nothing whatsoever is left over from the in-flight
   tick.
5. **Expected — sound:** if the bail-out happened at or before the `after playAlert`
   checkpoint, no sound should have played; if it happened at a later checkpoint (e.g. `after
   AUTO_OPEN read` or the `800ms settle` ones), the sound may already have played before the
   bail — that's expected and out of scope for this fix (audio can't be "un-played"; the fix
   is specifically about DOM the extension creates/restores, per the instruction's scope).
6. **Regression — logout with the loop idle (not running):** log out with the loop paused.
   **Expected:** unchanged from TC-AUTH-6 — sidebar disappears immediately, nothing else to
   check since no tick was in flight.
7. **Regression — normal ticks unaffected:** with the fix in place, start the loop and let
   several ticks complete normally **without** logging out. **Expected:** identical behavior
   to before this fix — new loads highlight, sound plays, top load auto-opens, inline panel
   shows normally, no spurious "bailing" log lines appear.

### TC-AUTH-8 — Failed activation does not lock the extension out; the next attempt recovers

Regression test for the activation lockout fixed 2026-07-30 (audit finding B1, High —
`_extActivated` was set before the awaits in `activateExtensionUI()`, so any throw in
`tabState.init()` or `buildSidebar()` left the flag `true` with no UI, and every later
activation returned early on it; only a page reload recovered). Control flow was proved with a
Node harness against the real source text (see CHANGELOG.md 2026-07-30); **this is the
outstanding real-browser check.**

Steps 1–5 need an induced failure, since neither step throws on its own in normal operation.
Induce it by temporarily adding `throw new Error('test');` as the first line of `buildSidebar()`
in `content/sidebar.js` — remove it again before step 6, and never ship it.

1. With the throw in place, log in (or reload an already-logged-in Relay tab).
   **Expected:** no sidebar appears, and the console shows
   `[EXT][…][content] activateExtensionUI failed — rolling back, extension stays inactive`
   with `{ step: "buildSidebar", error: … }`. It must appear at the **shipped**
   `DEBUG_LEVEL = 1` (it is a `logger.error`) — confirm at level 1, not just at 3 or 4.
2. **Expected — nothing left behind:** `document.getElementById('ext-sidebar')` returns `null`,
   no `.ext-new-load` / `.ext-surge-price` highlights, no `#ext-inline-panel`, and
   `document.body.style.paddingTop` is empty (the bar's padding was reverted). The page looks
   untouched, exactly as when logged out.
3. **Now remove the induced `throw`** from `buildSidebar()` and — **without reloading the
   page** — log out and log back in via the popup, which fires `activateExtensionUI()` again.
   **Expected (this is the whole point):** the sidebar appears normally. Before the fix it did
   not, and no reload-free path existed to get it back.
4. **Expected — exactly one of everything after that recovery:** exactly one `#ext-sidebar`
   element (`document.querySelectorAll('#ext-sidebar').length === 1`); Play/Pause toggles the
   loop once per click, not twice; the memory indicator updates on a single ~7s cadence, not a
   doubled one; the interval slider reacts once per change.
5. **Expected — the recovered sidebar actually works:** Play starts the loop, new loads
   highlight, the inline panel opens on a card click, and Pause stops it. A retry that produces
   a visible-but-dead sidebar is a failure of this test.
6. **Regression — happy path unchanged.** With no induced throw, reload a logged-in Relay tab.
   **Expected:** identical to before the fix — one sidebar, `activateExtensionUI called` then
   `extension UI activated — waiting for manual Start` in the console, and **no** `rolling back`
   error line.
7. **Regression — deactivate → activate still works** (overlaps TC-AUTH-6): log out, confirm the
   sidebar disappears, log back in, confirm it returns — once, and working.
8. **Re-entrancy.** Hard to force by hand; the harness covers it. The observable proxy: log out
   and back in rapidly several times, or log in from the popup at the same moment a Relay tab is
   finishing its own load. **Expected:** at most one `activateExtensionUI: activation already in
   flight — ignoring` line, never two `buildSidebar called` lines for one activation, and always
   exactly one `#ext-sidebar`.

**Known limitation, out of scope for this fix (see CHANGELOG.md):** logging out *while*
activation is still in flight can still leave a sidebar built for a logged-out session. Not a
failure of this test case.

### TC-AUTH-9 — Popup opens straight into the right block, and a lost connection never logs you out

Covers the 2026-07-30 change to render from local storage and validate in the background.
Sequencing and error classification were proved with a Node `vm` harness running the **real**
Supabase bundle with only `fetch` swapped (51 checks — see CHANGELOG.md). **The browser-only
parts are the visual/timing claims in steps 1, 2 and 6.**

1. **Signed in — instant panel.** Sign in, close the popup, reopen it. **Expected:** the
   logged-in panel is there essentially immediately — no "Checking your session…", no visible
   delay, and the words "Free access — sign in with your email" never appear, not even for one
   frame. Reopen 5–10 times including right after a browser restart. Screen-record and step
   through the frames if you want proof rather than impression.
2. **Signed out.** Log out, reopen. **Expected:** the login form immediately. Feature controls
   (Night Mode, Sound, Filters, Booking, Reset) never appear, not even for one frame.
3. **Offline while signed in — the second half of the fix.** Signed in, go offline (devtools →
   Network → Offline, or pull the adapter), then open the popup. **Expected:** the panel opens
   normally and **stays**. "No connection — check your internet." appears in the status line
   under Account. The login form must **never** appear. Then go back online and reopen —
   normal panel, no message, still signed in. Check `chrome.storage.local` in devtools:
   `supabaseSession` must still be there throughout. Console shows a `logger.error`
   "session validation could not reach the server — staying signed in, session NOT cleared"
   with `errorName: "AuthRetryableFetchError"`. Confirm at the shipped `DEBUG_LEVEL = 1`.
4. **Server says the session is invalid.** Sign in, then invalidate the session server-side
   (Supabase dashboard → revoke, or delete the user's sessions), then open the popup.
   **Expected:** the panel appears briefly and is then replaced by the login form, and
   `supabaseSession` is gone from storage. *The brief panel is the accepted trade-off, not a
   bug.* Alternative if you cannot revoke server-side: hand-edit `supabaseSession.access_token`
   in devtools to a corrupted-but-still-3-part JWT — the server will 401 it.
5. **Pending OTP resume** (regression against TC-AUTH-1). Enter your email, Send code, close the
   popup without entering the code, reopen. **Expected:** the **code** step with the email
   prefilled and "Enter the code sent to …" — not a blank email step. Repeat with a
   server-invalidated session (step 4's setup) — the fallback must still land on the code step.
6. **Expired session + offline — known slow path.** Let the stored session expire (or edit
   `expires_at` in devtools to now+10s), go offline, open the popup. **Expected:** the login
   form appears **immediately** (it no longer waits on anything), `supabaseSession` is **not**
   cleared, and the "No connection" message appears **late — up to ~30s**. That delay is
   gotrue's own retry loop (`_refreshAccessToken` retries while the error is retryable, bounded
   by `N = 30*1e3`; measured at ~25.6s in the harness), not our code. Then go back online and
   reopen: the silent refresh should succeed and you should land on the panel — proving nothing
   was lost by not clearing the session.
7. **Regression — login end to end.** From logged out: email → Send code → real code → Verify →
   features appear. Then Log out. **Expected:** unchanged from TC-AUTH-4/6.
8. **Regression — silent refresh** (TC-AUTH-3). Expired session, **online**, open the popup.
   **Expected:** the login form appears first and is then replaced by the panel once the refresh
   succeeds, and the refreshed session is written back to storage.
9. **Regression — cross-page sync.** With the popup open and signed in, log out from a second
   surface (or clear `SUPABASE_SESSION_KEY` in devtools). **Expected:** the popup switches to
   the login form live, as before.

**Deliberate, not bugs:** (i) the brief panel in step 4 — PM decision, access is free at this
stage so there is nothing to gate; (ii) the popup paints its header and "Account" title before
the decided block appears, because `chrome.storage.local.get` is async — that gap is a local IPC
round trip, not a network one, and no *wrong* block is ever shown during it.

### TC-PANEL-WIDTH-1 — Inline panel segment table spans the full card width, with column/row borders

**Superseded/incomplete:** the fix this test case covers (`.ext-inline-panel{width:100%}`)
was necessary but not sufficient — the table itself still rendered at ~40-45% width
afterward. Root cause (Amazon's global `table{display:block}` rule) and the actual fix are
in TC-PANEL-WIDTH-2 below; steps 1–2 of this test case (full-width table) will not pass
until TC-PANEL-WIDTH-2's fix is also in place. Steps 3–8 (column proportions, header
distinction, action bar) remain valid checks regardless.

Regression test for the layout fix in `injectPanelStyle()` (2026-07-20 — panel collapsed to
~half width, left-aligned). **Not yet run in a browser** — no rendering environment was
available to verify this fix; every check below is outstanding.

1. Open a **single-segment** load's inline panel (click a load card, or let auto-open trigger
   it). **Expected:** `ext-inline-panel` (and the stop table inside it) spans the **full
   width** of the load card — no large empty area on the right, not collapsed to the left.
2. Open a **multi-segment** load's inline panel, expand a segment. **Expected:** same —
   the expanded segment's stop table spans the full card width.
3. **Expected — column proportions unchanged and correct:** within the full-width table,
   the Stop column is visibly widest (~40%), with Equipment/Id, Arrival, and Departure each
   roughly equal (~20% each) — this was already correct before the fix and must stay so.
4. **Expected — borders:** visible 1px separator lines both between rows (horizontal) and
   between columns (vertical) — previously only row separators existed. The rightmost
   column should not show a double/redundant line against the panel's own outer border.
5. **Expected — header:** the header row (Stop / Equipment / Id / Arrival / Departure)
   has a subtle background tint distinguishing it from the data rows below, and consistent
   padding with the data rows (not visibly tighter/looser).
6. **Expected — no overflow:** the panel's outer border does not visibly overflow past the
   load card's right edge by a pixel or two (checks `box-sizing:border-box` is doing its
   job).
7. **Regression — Night Mode:** toggle Night Mode on, repeat steps 1–5. **Expected:** same
   full-width layout and bordered look, colors adapted to the dark surface (no light-mode
   colors — e.g. a bright white header background — leaking through).
8. **Regression — action bar / Fast Book button unaffected:** confirm the action bar
   (screenshot/map/create-post/Fast Book icons) at the bottom of the panel still renders and
   functions normally — this fix did not touch `.ext-action-bar`/`.ext-action-btn` CSS.
9. **Not covered by this fix (reported separately, not implemented):** per-segment payout,
   segment ID label, and stop-level warnings (e.g. Road Restriction) are absent from the
   panel entirely; segment distance/duration is shown only for multi-segment loads, not
   single-segment ones. None of these are expected to appear as a result of this fix.

### TC-PANEL-WIDTH-2 — Table spans full card width (real root cause: Amazon's global `table{display:block}` rule)

Regression guard for the actual root cause, found by live browser measurement (not a
hypothesis): Amazon applies a global rule setting `<table>` to `display:block`, which makes
the browser build an anonymous shrink-to-fit table box internally — `width:100%` alone
(TC-PANEL-WIDTH-1's fix) cannot override this. Fixed via `display:table !important;width:100%
!important` on `.ext-inline-panel__table`. **Not yet confirmed against the shipped code** —
the root cause and the *general* fix approach were confirmed live by the user via direct
DevTools element-style editing; what's outstanding is confirming `injectPanelStyle()`'s
actual generated rule produces the same result end-to-end, across all four required
scenarios.

**Before/after measurement script** — paste into DevTools console with an accordion segment
open:
```js
(function () {
  var panel = document.getElementById('ext-inline-panel');
  var table = panel && (panel.querySelector('table.ext-inline-panel__table')
                      || panel.querySelector('.ext-seg-body.ext-open table'));
  if (!panel || !table) { console.log('panel or open table not found'); return; }
  var panelCs = getComputedStyle(panel);
  var panelInner = panel.clientWidth - parseFloat(panelCs.paddingLeft) - parseFloat(panelCs.paddingRight);
  var tableRect = table.getBoundingClientRect();
  var tableCs = getComputedStyle(table);
  console.log({
    panelInnerWidthPx: panelInner.toFixed(1),
    tableRenderedWidthPx: tableRect.width.toFixed(1),
    tableComputedDisplay: tableCs.display,
    matches: Math.abs(panelInner - tableRect.width) < 2
  });
})();
```

1. Run the script above on a **single-segment** load in **light mode**. **Expected:**
   `tableComputedDisplay: "table"` (not `"block"`), and `tableRenderedWidthPx` equal to
   `panelInnerWidthPx` (within ~2px rounding tolerance) — `matches: true`. **Report both
   numbers.**
2. Repeat on a **multi-segment** load (expand a segment first) in **light mode**. Same
   expectation. **Report both numbers.**
3. Toggle **Night Mode** on, repeat step 1 (single-segment). Same expectation — table still
   full width; visually, colors adapt to the dark surface (no light-mode leakage). **Report
   both numbers.**
4. Toggle **Night Mode** on, repeat step 2 (multi-segment, expanded). Same expectation.
   **Report both numbers.**
5. **Regression — column proportions still correct at full width:** with the table now
   genuinely full-width, re-confirm the Stop column is visibly ~40% and the other three are
   ~20% each *of the new, correct total* — not just proportionally correct within an
   already-too-narrow table.
6. **Regression — other injected UI unaffected:** confirm the PAT modal (`ext-action-post`)
   and the sidebar (`ext-sidebar`) still render exactly as before — neither uses a `<table>`
   element (confirmed via codebase grep), so this fix should have zero visible effect on
   either, but worth a quick look since Amazon's global rule is page-wide and could
   theoretically interact with other elements we haven't audited.
7. **Regression — comment survives:** confirm the code comment above the fixed CSS rule in
   `content/inlinePanel.js` explaining why `!important` is required is still present (guards
   against a future "cleanup" silently reintroducing this bug).

### TC-PANEL-POLISH-1 — Segment header route grouping, header/cell styling, zebra striping

Regression test for the CSS polish pass in `injectPanelStyle()`/`buildPanelElement()` and
`content/nightMode.js` (2026-07-20). **Not yet run in a browser** — no rendering environment
was available; every check below is outstanding. Requires a **multi-segment** load for steps
1–3 (the route-group/right-cluster changes only apply to `.ext-seg-header`, which only
renders for multi-segment loads); single-segment loads only exercise steps 4–7.

1. Open a multi-segment load's inline panel. **Expected:** in each segment's header row, the
   stop-number badge, its station code, the arrow, the destination badge, and the
   destination code now read as **one visually grouped cluster** at the left — no longer
   drifting apart into a separate badge column vs. a route column.
2. **Expected:** the header's left group is sized to its own content (not stretched into a
   wide fixed column) — with a short route it should not leave a large empty gap between the
   route text and the next element.
3. **Expected:** distance/duration, load type (Drop/Live), status (Loaded/Empty), and the
   `⌄` chevron are clustered tightly together at the **right edge** of the header row, with
   a visibly larger gap separating them from the route group on the left than the gaps
   between the four of them.
4. **Expected — header row (`th`):** noticeably smaller, **UPPERCASE** column labels (Stop /
   Equipment / Id / Arrival / Departure), with visible letter-spacing, and shorter/tighter
   vertical padding than the data rows below — the header should read as clearly more
   compact than before.
5. **Expected — data cells (`td`):** the station code / city (primary line) is bold and a
   shade darker than the address line below it (secondary line, smaller and lighter); the
   two lines sit closer together than before (`margin-top:2px` on the address line); cell
   content is vertically centered, not top-aligned.
6. **Expected — borders:** only **horizontal** separator lines between rows remain — the
   vertical lines between columns added in the previous pass are gone. This should look
   less busy/noisy than the immediately preceding version.
7. **Expected — zebra striping:** every other data row has a very subtle background tint
   distinguishing it from its neighbors, making it easier to track a row across the full
   row width. Should be subtle, not a strong/obvious stripe.
8. **Expected — column proportions:** Stop is still clearly the widest column; Arrival and
   Departure are now very slightly wider than Equipment/Id (34/18/24/24, was 40/20/20/20) —
   a small but real shift, worth eyeballing.
9. **Regression — Night Mode:** toggle Night Mode on, repeat steps 1–7. **Expected:** same
   grouping/spacing/proportions; zebra striping is still visible (alternating rows
   distinguishable) — this specifically checks the new `content/nightMode.js` rule, since
   without it the existing dark-mode `tbody td` override would have silently erased the
   striping entirely while everything else still looked fine.
10. **Regression — single-segment loads unaffected by the removed grid:** open a
    single-segment load (no `.ext-seg-header` at all — table renders directly). **Expected:**
    header/cell/border/zebra/column-width changes (steps 4–8) all still apply normally; no
    console errors from the `.ext-seg-header`/`.ext-seg-route` restructuring, since that
    code path simply isn't reached for single-segment loads.
11. **Regression — action bar unaffected:** confirm the action bar (screenshot/map/
    create-post/Fast Book) still renders and functions normally at the bottom of the panel.
12. **Regression — layout width unaffected:** confirm the table still spans the full card
    width (the fix from the immediately preceding pass) — this task explicitly did not touch
    `display:table`/`width` and should have zero effect on it.

### TC-PANEL-POLISH-2 — Leg header redesign: dark navy grid-aligned bar, pill badges

**Colour superseded 2026-07-30 (later same day) by TC-PANEL-POLISH-3 below** — the header
background flipped from dark navy to a light grey-green-blue. Steps 1 and 3's "dark navy
background, white text" wording is stale; the GRID/alignment mechanics they otherwise
describe (no gap in the middle, column alignment, 16px inset) are unaffected by the color
change and still apply — just read them with the new light-mode colors from
TC-PANEL-POLISH-3 substituted in. Left as originally written (not rewritten) so this stays
an accurate record of what was tested at the time; step 8 (Night Mode) is fully unaffected
either way, since night mode's own header colors never used the navy value in the first
place.

CSS-only redesign of `.ext-seg-header`/`.ext-seg-body` (2026-07-30) — see CHANGELOG.md for
the full before/after. **Supersedes TC-PANEL-POLISH-1 steps 2-3**: the header no longer
clusters items at the right edge with a gap in the middle — that was the bug this pass
fixes. Steps 1, 4-12 of TC-PANEL-POLISH-1 (route grouping, table typography baseline,
zebra striping, single-segment regression, action bar, table width) still apply and are not
retested here except where their expected values changed (typography hex/sizes — see step 4
below). **Not yet run in a browser** — verified with Node `vm` structural checks (30/30) and
real coordinate-geometry arithmetic proving column-edge alignment at 600/900/2000px card
widths — not visual proof. Requires a **multi-segment** load (the header only renders for
multi-segment loads; single-segment loads only exercise the table typography, step 4).

1. **No gap in the middle (the reported bug):** open a multi-segment load's inline panel on
   a wide window/card (ideally close to the ~2000px width from the original report).
   **Expected:** the header reads as one continuous dark navy bar with content spread across
   its full width — no large empty gap between a left cluster and a right cluster.
2. **Column alignment:** with the segment expanded (table visible), visually compare the
   header's item positions against the table's column boundaries directly below.
   **Expected:** the left group (badge+codes) starts above "Stop"; distance/duration starts
   above "Equipment/Id"; the Live/Drop pill starts above "Arrival"; the Loaded/Empty pill
   starts above "Departure"; the chevron sits in its own narrow space at the far right,
   distinct from the Loaded/Empty pill.
3. **Header styling:** dark navy background, white text, bold-ish weight, small uppercase-
   feeling caps (the numbers/route codes won't visibly change case, that's expected — there's
   no literal "LEG N" label to uppercase, see the flagged gap in CHANGELOG.md). Comfortable
   height, nothing touching the card's left/right edges (16px inset visible on both sides).
4. **Expanded body:** background is pure white, visually distinct from the navy header above
   it (this is the core "everything greyish and blends together" fix) — and the table itself
   has a visible ~16px gap from the card's left/right edges, not flush against them.
5. **Stop code / address typography:** station code (bold, primary) is noticeably larger and
   darker than the address line beneath it (secondary, lighter grey) — check this still holds
   with the updated exact hex (`#111827` / `#6B7280`) versus TC-PANEL-POLISH-1's original
   values.
6. **Table header row:** small uppercase column labels, light grey-blue background,
   visible thin bottom border — check this still holds with the updated exact hex
   (`#F9FAFB` background, `#E5E7EB` border) versus TC-PANEL-POLISH-1's original values.
7. **Pill badges:** the Live/Drop value and the Loaded/Empty value each render as a rounded
   pill (fully rounded ends, not a rectangle) with a light background and readably-contrasting
   colored text — light green for Loaded, light grey for Empty, light blue for Live/Drop/
   Preloaded — sized to their own text, not stretched to fill their grid cell.
8. **Regression — Night Mode:** toggle Night Mode on, repeat steps 1-7. **Expected:** the
   header/body still contrast clearly (both are intentionally dark now, at different
   elevation levels — not "everything the same navy"); the three pill badges still render
   as pills with a visible background fill (not just colored text on nothing — this is the
   part most likely to break if a dark-mode override is missing, since the universal
   transparent-background reset would otherwise strip the pill fill entirely); distance/
   duration and the stop address read as visibly muted/secondary compared to the stop code
   and route text, not equally bright.
9. **Regression — no HTML/JS behavior change:** clicking a segment header still expands/
   collapses it (chevron rotates), Fast Book / action bar still work, single-segment loads
   still render their table normally with no console errors — this was a CSS-only pass, no
   `buildPanelElement()`/`buildSegmentTable()` changes.

### TC-RATELIMIT-1 — Cross-tab rate limiting: global budget + synchronized backoff

**PRE-LAUNCH BLOCKER — see docs/BACKLOG.md.** Nothing in this test case has been run in an
actual browser; `background.js`'s core permit/backoff algorithm was verified with real
functional tests (18/18, pure logic, no DOM) and `content/content.js`'s integration with
4/4 — see CHANGELOG.md 2026-07-20 for exactly what those covered and did not cover.

**Setup:** log in. Open 4 separate tabs on the Relay load board (same profile, same
network). Have DevTools open on at least one tab (Console + Network), and if possible the
service worker's own console (`chrome://extensions` → this extension → "service worker"
link, or `chrome://inspect/#service-workers`).

1. Start the loop (Play) in all 4 tabs, with the same slider speed (default 2s is fine —
   confirm changing it in tab 1 updates the displayed value in tabs 2-4 live, per the
   "global setting" requirement).
2. **Expected — aggregate rate:** watch the Network tab (or the service worker's console
   logs) across all 4 tabs combined. Board requests should occur roughly once every
   `GLOBAL_MIN_PERMIT_INTERVAL_MS` (5000ms by default) **total**, not once every ~2s **per
   tab** (which would be ~4x too fast, the original bug). Individual tabs will visibly
   "skip" ticks — this is expected and correct, not a bug (see `orchestratorTick: no
   permit — rate limiter active, skipping this tick` in that tab's console).
3. **Expected — no tab starves:** over a couple of minutes, confirm each of the 4 tabs
   gets roughly its fair share of the granted permits over time (not e.g. tab 1 getting
   every single grant while tabs 2-4 never refresh) — this is the "round robin" FIFO
   requirement.
4. **Force/simulate a 503:** easiest approach — use DevTools' "Block request URL" (Network
   tab → right-click a `/api/loadboard/search` request → Block request URL) in ONE tab, or
   throttle to "Offline" briefly, to produce a failed/blocked request that
   `content/networkObserver.js` should observe and report as a failure.
5. **Expected — all tabs pause together:** within moments of the failure being reported,
   **every one of the 4 tabs'** sidebars should switch from the slider view to the amber
   paused banner — not just the tab where the failure was simulated. This is the core "one
   shared state, not per-tab backoff" requirement. **Updated 2026-07-30:** the banner text
   is now static ("Paused — Amazon has temporarily limited your IP…", see TC-RATELIMIT-5);
   there is no longer a countdown, and `ext-playpause` now stays visible next to it.
6. **Expected — identical banner everywhere:** all 4 tabs show the same banner with no
   per-tab variation. (Superseded step: this used to check that a per-tab 1-second
   countdown stayed roughly in sync — both the countdown and its timer are gone as of
   2026-07-30, so there is nothing left that could drift.)
7. **Expected — synchronized resume:** once a real 200 is observed, all 4 tabs should
   return to the normal slider view together and resume requesting — again subject to the
   shared global pacing from step 2, not all 4 firing at once. **Note (2026-07-30):** the
   banner is gated on an observed success only. The backoff timer merely expiring no longer
   clears it — that is the point of the change (see TC-RATELIMIT-5 step 4).
8. **Expected — exponential backoff on repeated failures:** if you can simulate multiple
   consecutive failures (e.g., keep the URL blocked across several retry attempts), the
   wait time between attempts should visibly grow (~5s → ~10s → ~20s → ~40s → ~80s →
   capped at 5 minutes), not stay flat or reset on each failure.
9. **Regression — persistence across popup reopen:** while a tab is showing the paused
   banner, open the extension popup, close it again. **Expected:** the sidebar banner is
   unaffected — still shown, unchanged.
10. **Regression — persistence across tab reload:** while paused, reload one of the 4
    tabs. **Expected:** after the page (and extension) reloads, that tab's sidebar
    immediately shows the paused banner again (not the normal slider view as if nothing
    were wrong). **Updated 2026-07-30:** this is now genuinely honest — the old countdown
    restarted from a fresh full backoff on reload, which was one of the reasons it was
    removed. The banner survives the reload because it reads a persisted sticky flag, not a
    timestamp.
11. **Regression — single-tab behavior unaffected by the new floor:** with only 1 tab
    open and the slider set well above the global floor (e.g. 8s), confirm normal
    operation is completely unaffected — requests still happen roughly every 8s, no
    unexpected pauses, no banner ever appears absent an actual failure.
12. **Regression — logged-out tabs don't interfere:** with one tab logged in and running
    and a second tab logged out (no session), confirm the logged-out tab shows no sidebar
    at all (per existing gating) and does not affect the logged-in tab's pacing or backoff
    state.
13. **Regression — existing features unaffected:** with the loop running normally (no
    backoff active), confirm load detection, highlighting, sound, auto-open, and the PAT
    modal all still work exactly as before — this task only gates the timing of
    `refreshNow()`, it does not change what happens once a refresh is allowed to proceed.

### TC-RATELIMIT-2 — "Shared refresh limit" toggle: pacing is optional, backoff is not

**Not yet run in a browser** — `background.js`'s pacing/backoff gating was verified with
real functional tests (15/15, pure logic, no DOM); the popup toggle/tooltip and
`content.js`'s wiring were verified structurally only (source-text assertions, since these
are DOM-heavy files) — see CHANGELOG.md 2026-07-20 (follow-up entry) for exactly what those
covered and did not cover.

**Setup:** log in, open the popup. Confirm "Shared refresh limit" appears in Display &
Alerts, right after Auto-Open Top Load, defaulting to ON (checked).

1. **Tooltip — hover:** hover the circled "i" icon next to the label. **Expected:** a
   tooltip appears with the exact text "Amazon blocks too-frequent refreshes and can
   temporarily cut off access from your IP. This mode shares one refresh budget across all
   your tabs so you don't hit that limit. Turn it off to give each tab its own timer." Move
   the mouse away — tooltip disappears.
2. **Tooltip — keyboard:** Tab to the info icon (don't click/hover). **Expected:** the same
   tooltip appears on focus, and disappears on blur (Tab away). Confirm it does NOT rely on
   a native browser title tooltip (should appear instantly on focus, not after a hover
   delay).
3. **Live sync across tabs:** open the popup in two different Relay tabs (or popup + a
   second popup instance). Toggle "Shared refresh limit" OFF in one. **Expected:** the
   toggle reflects OFF in the other popup instance without closing/reopening it, and the
   change takes effect in any open Relay tab's sidebar behavior within one tick — no page
   reload needed.
4. **OFF mode — no shared pacing:** with the toggle OFF and 3-4 tabs open at a fast slider
   speed (e.g. 2s), confirm each tab now refreshes independently on its own ~2s cadence
   (no longer waiting for `GLOBAL_MIN_PERMIT_INTERVAL_MS` turns from other tabs) — i.e. the
   "skip this tick, rate limiter active" log line from TC-RATELIMIT-1 step 2 should no
   longer appear due to pacing (only due to backoff, if any). This is expected to
   reintroduce the original 503 risk from many fast tabs — that's the accepted tradeoff of
   turning the toggle off.
5. **OFF mode — backoff still applies (core requirement):** with the toggle OFF, force/
   simulate a 503 in one tab (see TC-RATELIMIT-1 step 4 for how). **Expected:** exactly as
   in ON mode — that tab's sidebar (and every other open tab's sidebar) shows the paused
   banner and stops refreshing until access returns, even though pacing coordination is
   off. This is the one thing the toggle must NOT be able to disable. (Banner wording as of
   2026-07-30 — see TC-RATELIMIT-5.)
6. **Toggle OFF → ON while paused:** while a tab is in backoff with the toggle OFF, switch
   the toggle to ON. **Expected:** no disruption to the in-progress backoff (it's
   shared/global state, unaffected by the toggle); once a request succeeds, tabs resume
   under the now-ON shared pacing.
7. **Reset restores default:** click "Reset to Defaults" in the popup. **Expected:**
   "Shared refresh limit" returns to ON (checked).
8. **Persistence across restart:** set the toggle OFF, close the browser (or reload the
   extension via `chrome://extensions`), reopen. **Expected:** the popup still shows OFF —
   the setting is global and persists, not reset per session.

### TC-RATELIMIT-3 — Shared-limit pacing: 1 tab matches the setting, N tabs split it fairly

**Bug this covers (reported with real data):** with "Shared refresh limit" ON and only 1
tab open, the tab was refreshing every ~3.5s despite a 2s slider setting — the shared floor
was a hardcoded 5000ms constant unrelated to the dispatcher's own setting, and tick overhead
(permit round-trip + settle + pipeline) was compounding on top of the interval every cycle
instead of being subtracted from it. Fixed 2026-07-30 — see CHANGELOG.md for the full
before/after. **Not yet run in a real browser** — verified with real-timing Node `vm`
simulations (background.js's actual code + a faithful replica of content.js's own
compensation algorithm) — 9/9 checks, real wall-clock timing, not mocked. See CHANGELOG.md
2026-07-30 for exactly what those covered.

**Setup:** log in. Ensure "Shared refresh limit" is ON (default). Set the slider to 2s.
Have DevTools Network tab open, filtered to `/api/loadboard/search`.

1. **1 tab matches the setting exactly:** with only this one tab open and running, watch
   the Network tab for at least 30s. **Expected:** requests land roughly every 2s (±10-15%
   for real network/DOM variance is fine) — NOT every ~3.5-5s as before this fix. This is
   the core regression this fix addresses.
2. **4 tabs — combined rate matches the setting:** open 3 more tabs (4 total), all logged
   in, all running, all with the slider at 2s (confirm it reads 2s in all 4 — it's global).
   Watch the **combined** request rate across all 4 tabs' Network tabs (or the service
   worker's console log of grants) for at least 60s. **Expected:** the combined rate across
   all 4 tabs together is ~1 request every 2s **total** — meaning each individual tab
   should visibly refresh roughly every ~8s (2s × 4 tabs), not more often. Compare against
   TC-RATELIMIT-1 step 2's aggregate-rate check — this test additionally confirms the
   *per-tab* cadence lands near the expected `interval × N`, not just the aggregate.
3. **No tab starves:** over the 60s window in step 2, confirm each of the 4 tabs got
   roughly its fair share of grants (not one tab hogging most of them) — same requirement
   as TC-RATELIMIT-1 step 3, re-checked here since the floor computation changed.
4. **Closing a tab speeds up the rest immediately:** with 4 tabs running as in step 2,
   close one tab (or log it out). **Expected:** within roughly one cycle, the remaining 3
   tabs' cadence visibly speeds up toward ~6s each (2s × 3) — no multi-cycle lag before the
   speed-up takes effect.
5. **Live slider change takes effect for pacing:** with 2+ tabs running, change the slider
   in one tab to a different value (e.g. 2s → 4s). **Expected:** all open tabs' displayed
   slider value updates (existing behavior), AND the actual pacing floor used for grants
   updates too — the per-tab cadence should shift toward the new `interval × N`, not stay
   locked to the old value.
6. **Original 503 regression still prevented:** re-run TC-RATELIMIT-1's steps 1-3 (multiple
   tabs at a fast setting) and confirm no sustained 503s reappear — this fix changes HOW the
   floor is computed, not the guarantee that the combined rate across all tabs stays
   bounded.
7. **Backoff unaffected:** re-run TC-RATELIMIT-1 steps 4-8 (force a 503, confirm all tabs
   pause with a synchronized countdown and resume together) — this fix only touches the
   pacing floor computation, not the backoff check, which still runs first in
   `grantOrDenyPermit()`.

### TC-RATELIMIT-4 — Shared-limit UX: mode-aware label + live "Active tabs: N" status line

**Not yet run in a browser.** `background.js`'s new active-tab registry was verified with
real functional tests (14/14, pure logic, no DOM); `sidebar.js`'s label/status-line
rendering was verified by running the ACTUAL `buildSidebar()` source against a minimal fake
DOM and asserting on the real elements it created (17/17) — this is real logic coverage,
not just structural/regex checks, but it is still not a substitute for seeing it render in
an actual browser. See CHANGELOG.md 2026-07-30 for exactly what those covered.

**Setup:** log in, open the load board. Confirm "Shared refresh limit" is ON (default) in
the popup.

1. **OFF mode label:** turn "Shared refresh limit" OFF in the popup. **Expected:** the
   sidebar's slider text reads exactly `"Refresh every 2.0s"` (or whatever the slider is
   currently set to) — no second status line below it, bar stays its original single-row
   height.
2. **ON mode label, 1 tab:** with only this one tab open, turn "Shared refresh limit" ON.
   **Expected:** the slider text changes to `"Shared rate: 1 refresh / 2.0s"`, and directly
   below it a new line reads `"1 active tab → refreshing every 2.0s"` — note the singular
   phrasing and that X equals the slider value exactly (nothing is being slowed down with
   only 1 tab).
3. **N tabs — live count:** open 3 more tabs (4 total), all logged in and running.
   **Expected:** within a moment of each tab starting, EVERY open tab's status line updates
   to read `"Active tabs: 4 → each tab refreshes every 8.0s"` (2.0s × 4) — check this in
   more than one tab's sidebar, not just the one that just opened.
4. **Closing a tab updates N live, no reload:** close one of the 4 tabs. **Expected:**
   within a moment, the remaining 3 tabs' status lines update to `"Active tabs: 3 → each tab
   refreshes every 6.0s"` — no page reload needed anywhere.
5. **Logging out updates N live:** with 3+ tabs still open and running, log out in ONE of
   them (via the popup). **Expected:** that tab's sidebar disappears entirely (existing
   logout behavior); the REMAINING tabs' status lines update N downward accordingly, live.
6. **Pausing updates N live (flagged judgment call — confirm this is the intended
   behavior):** with 3+ tabs open and running, click Play/Pause to pause ONE of them
   (without logging out). **Expected:** the paused tab's own sidebar reverts to normal
   play/pause+slider display; the OTHER tabs' status lines update N downward, since a
   paused tab is not part of the round-robin. If this is NOT the desired behavior (i.e., a
   paused-but-logged-in tab should still count toward N), that's a one-line change to
   revert — flag it either way.
7. **Backoff hides the status line:** with shared mode ON and 2+ tabs, force/simulate a 503
   (see TC-RATELIMIT-1 step 4). **Expected:** the paused banner appears as before, and the
   shared-rate status line disappears while paused (not shown alongside the banner) —
   reappears with the correct N once a request succeeds. **2026-07-30:** both now read the
   same `isRateLimitPaused()`, so a state where the banner and the status line are visible
   simultaneously is not reachable.
8. **Live slider change updates X immediately:** with shared mode ON and N>1 tabs, change
   the slider value in any tab. **Expected:** every open tab's status line recomputes X
   (interval × N) immediately using the new interval, with no reload.
9. **No visual jump/clipping:** watch the page content just below the sidebar as the status
   line appears/disappears (mode toggle, entering/leaving backoff). **Expected:** the page
   content shifts down/up smoothly with the bar's height change, no overlap, no flash of
   unpadded content.
10. **Regression — logout reverts the page fully:** log out entirely (last/only tab).
    **Expected:** the sidebar and all its DOM are removed, AND the page's top padding
    reverts to its original (pre-extension) value — inspect via DevTools that
    `document.body`'s inline `padding-top` style is gone, not left over from the shared-rate
    row.

### TC-RATELIMIT-5 — Paused banner: no countdown, honest copy, "i" tooltip, sticky until success

> ## ⛔ OBSOLETE as of 2026-07-31 — DO NOT RUN
>
> The paused banner, its "i" icon, and its tooltip were **removed** by PM decision (see
> CHANGELOG.md 2026-07-31 and BACKLOG.md "Sidebar paused/rate-limit message"). Every step below
> checks something that no longer renders. Kept verbatim, not deleted, because the removal is
> explicitly reversible — if the banner is reinstated, this is the test case to bring back with
> it. **Superseded by TC-RATELIMIT-6**, which verifies the message is gone and the pause
> behaviour survived.

**Automated coverage already run (2026-07-30, no browser in the build environment):** 50/50
on a DOM-stub harness driving the real `buildSidebar()` — exact banner and tooltip copy, no
digits-plus-`s` anywhere in the banner text, show-on-failure / stay-shown-after-the-backoff-
timestamp-passes / hide-on-success, reload re-seed, legacy-state fallback, hover + focus +
tap tooltip toggling, testids and roles, and that the 1s countdown interval is gone (exactly
one interval is still created: the 7s memory poll). 13/13 on `background.js` including an
A/B against the committed file proving the backoff schedule is unchanged. **What follows is
therefore the CSS/visual and real-browser half only — none of it has been run.**

**Setup:** log in, open the load board, start the loop. Force a failure the same way as
TC-RATELIMIT-1 step 4 (DevTools → Network → right-click a `/api/loadboard/search` request →
Block request URL, or throttle to Offline briefly).

1. **Banner copy — exact text.** **Expected**, on one line, in amber:
   "Paused — Amazon has temporarily limited your IP due to frequent refreshes. Access
   returns on its own; the extension will resume automatically."
2. **No number anywhere.** Confirm there is no "Retrying in Xs", no seconds value, and no
   digit that ticks. The banner text must be completely static for as long as it is shown —
   watch it for a full minute.
3. **Controls while paused.** **Expected:** the refresh slider and its label are hidden;
   **play/pause remains visible and clickable** (this changed on 2026-07-30 — confirm you
   can still pause and restart the loop while the banner is up); the memory dot and its "i"
   are still in place at the right.
4. **Sticky past the old countdown (the core behaviour change).** Keep the request blocked
   long enough for at least one backoff step to elapse (5s, then 10s…). **Expected:** the
   banner does **not** flicker off and back on as each backoff window expires — it stays up
   continuously. Previously it disappeared the moment the countdown hit zero even though
   nothing had actually recovered.
5. **Clears on the first real success.** Unblock the URL. **Expected:** on the first
   successful `/api/loadboard/search` response the banner disappears in **every** open tab
   and the slider + slider-label return. Note this can be triggered by Amazon's own page
   request, not only by an extension-driven refresh.
6. **Survives a reload while paused.** With the URL still blocked and the banner showing,
   reload the page. **Expected:** the banner is showing again as soon as the sidebar builds
   — no normal-looking slider view first, and no fresh countdown.
7. **Tooltip — hover.** Hover the circled "i" at the end of the banner. **Expected:** a
   tooltip appears below the bar with exactly:
   "Amazon limits how often the load board can be refreshed from a single IP address. When
   the limit is hit, the whole site stops loading for a while — this is not an account issue
   and nothing is wrong with your extension. It clears by itself. To avoid it, turn on
   Shared refresh limit in the extension settings: it spreads one refresh budget across all
   your open tabs instead of each tab refreshing on its own."
   Move the mouse away — it disappears.
8. **Tooltip — keyboard.** Tab to the "i" without hovering. **Expected:** the same tooltip
   appears instantly on focus (with a visible focus ring), disappears on blur. Confirm it is
   the custom tooltip, not a native `title` (no hover delay).
9. **Tooltip — not clipped (specifically re-check this).** `#ext-sidebar` changed from
   `overflow:hidden` to `overflow:visible` for this. **Expected:** the tooltip renders fully
   below the bar, is not cut off at the bar's bottom edge, and is not hidden behind Amazon's
   own page content (it carries the max z-index). Check in both light and night mode.
10. **The memory "i" tooltip now renders too.** It was clipped by the same rule and had
    never actually been visible. **Expected:** hovering `ext-memory-info` now shows its
    tooltip properly. Confirm it does not overlap or collide with the rate-limit tooltip
    when the banner is showing.
11. **Narrow viewport.** Shrink the window to ~800px wide while the banner is showing.
    **Expected:** the bar stays within the viewport (it now has `max-width:calc(100vw -
    16px)`), the sentence truncates with an ellipsis, and **the "i" icon is never truncated
    away** — it must remain visible and hoverable at every width, since it is the only route
    to the full explanation.
12. **Night mode.** Toggle night mode with the banner showing. **Expected:** the banner
    stays the same amber (it is deliberately theme-independent), the "i" ring/glyph follow
    that amber, and the tooltip flips to the light-on-dark treatment used by the memory
    tooltip.
13. **Regression — backoff timing untouched.** With the URL blocked across several retries,
    confirm from the service-worker console that the gaps still grow ~5s → ~10s → ~20s →
    ~40s → ~80s → capped at 5 min, and reset after a success. The banner change must not
    have altered any of this.

### TC-RATELIMIT-6 — Paused message removed; pause behaviour survives (2026-07-31)

Supersedes TC-RATELIMIT-5. The message is gone by PM decision; **the backoff/pause behaviour
must be exactly as before**. That behaviour half was verified automatically — a Node `vm`
harness drove the real `background.js` through its real `chrome.runtime.onMessage` listener for
both 429 and 503 (pause → permits refused → escalate → auto-resume on 2xx), and built the real
`buildSidebar()` against a stub DOM in both paused and unpaused states: 79/79 pass, and
`background.js` / `networkObserver.js` were never edited. **What follows is the real-browser
half, which has NOT been run.**

**Setup:** log in, open the load board, start the loop. Force a failure as in TC-RATELIMIT-1
step 4 (DevTools → Network → right-click a `/api/loadboard/search` request → Block request URL,
or throttle to Offline briefly).

1. **Nothing appears while paused.** **Expected:** no amber line, no "Paused — Amazon has
   temporarily limited your IP…" text, no circled "i" next to it, anywhere in the sidebar, in
   any state. Search the page DOM for `ext-rate-limit` — **zero matches** in both light and
   night mode.
2. **The speed slider stays put.** **Expected:** the refresh slider and its label remain
   visible and usable throughout the pause. (They used to hide to make room for the banner;
   that hiding was removed with it.) No blank gap appears in row 1 where the banner used to be.
3. **Row 1 is otherwise unchanged.** **Expected:** title, play/pause, slider, slider label,
   memory dot, memory "i" — same order, same spacing, nothing missing, no stray empty element.
   Play/pause still works while paused.
4. **The memory tooltip still works.** Hover and keyboard-focus `ext-memory-info`. **Expected:**
   its tooltip still appears fully below the bar and is not clipped — its CSS rules were
   un-shared from the removed ones, so this is the specific regression risk. Check light **and**
   night mode.
5. **The bar shrinks while paused — expected, not a bug.** With shared mode ON and 2+ tabs, note
   that row 2 ("Active tabs: N…") still hides during a pause, so the bar goes 60px → 40px.
   **Expected:** the page content below shifts by exactly that amount and there is no gap,
   overlap, or content hidden behind the bar (body padding tracks it). Flagged because with the
   message gone there is now **no on-screen explanation of a pause at all**.
6. **Polling really does still stop.** With the URL blocked, watch the service-worker console.
   **Expected:** `REQUEST_PERMIT` is refused while backoff is active — the extension is not
   quietly hammering Amazon now that the visible indicator is gone.
7. **Auto-resume still works.** Unblock the URL. **Expected:** on the first successful
   `/api/loadboard/search` the loop resumes by itself with no user action, in every open tab,
   and row 2 reappears with the correct N.
8. **Regression — backoff timing untouched.** As TC-RATELIMIT-5 step 13: gaps still grow ~5s →
   ~10s → ~20s → ~40s → ~80s → capped at 5 min, reset after a success.

### TC-RATELIMIT-7 — Only a genuine 429/503 pauses; aborts and other statuses do not (2026-07-31)

Regression test for the fix that stopped ordinary saved-search switches pausing the extension.
**Automated coverage already run (89/89, no browser):** the real `networkObserver.js` driven with
a real `AbortController`, the real `background.js` driven through its real message listener, an
end-to-end pipe between them, and an A/B against the committed `background.js` proving the
backoff schedule is unchanged. **What follows is the real-browser half — NOT run.**

**Setup:** log in, open the load board, start the loop. Keep the service-worker console open
(`chrome://extensions` → Service worker) and the page console open.

1. **The reported bug — saved-search switching.** With the loop running, switch between saved
   searches 10+ times in a row, quickly. **Expected:** no pause. `[background] non-rate-limit
   result ignored…` must **not** appear either (an abort should produce no report at all, so
   there is nothing to ignore). Confirm in the service-worker console that `REQUEST_PERMIT` is
   still being granted throughout, and in `chrome://extensions` → storage that
   `extRateLimiterState` has `rateLimited: false` / `backoffUntil: null` — or does not exist at
   all if nothing has ever failed.
2. **Same, via ordinary navigation.** Navigate away from the load board mid-refresh, and use the
   browser Back button. Any in-flight search is aborted. **Expected:** same as step 1 — no pause.
3. **Genuine 429 still pauses.** DevTools → Network → right-click a `/api/loadboard/search`
   request → *Block request URL* will give you a failed request, but **not** a 429 — for a real
   status you need an override. Use DevTools **Local Overrides** or a proxy to force a `429` on
   that path. **Expected:** the extension pauses — `extRateLimiterState.rateLimited: true`,
   `backoffStepIndex: 0`, `backoffUntil` ~5s out, and `REQUEST_PERMIT` refused in the
   service-worker console.
4. **Genuine 503 still pauses.** Repeat step 3 forcing `503`. **Expected:** identical.
5. **Escalation intact.** Keep the 429 (or 503) override in place across several retries.
   **Expected:** gaps grow ~5s → ~10s → ~20s → ~40s → ~80s → capped at 5 min, ±20% jitter.
6. **Auto-resume intact.** Remove the override. **Expected:** on the first successful
   `/api/loadboard/search` the loop resumes by itself, `rateLimited` goes false, `backoffUntil`
   null, `backoffStepIndex` back to -1.
7. **Other statuses do not pause.** Force a `404`, then a `500`, then a `401` on that path (same
   override mechanism). **Expected for each:** no pause, `extRateLimiterState` unchanged, and
   `[background] non-rate-limit result ignored for backoff purposes { status: … }` in the
   service-worker console. *This log line is the marker that the result arrived and was
   deliberately ignored — distinct from step 1, where nothing should arrive at all.*
   **Note `500` specifically:** it must NOT pause, while `502` and `504` must (step 7a). That
   split is deliberate — see the comment at `RATE_LIMIT_STATUSES` in `background.js`.
7a. **502 and 504 DO pause.** Force each in turn. **Expected:** identical to steps 3–6 — pause,
   escalation, auto-resume. These were added on a safety-side default without captured evidence
   that Amazon throttles via a gateway status; if you ever capture what Amazon *actually* returns
   under a real throttle, revisit the constant.
8. **Offline does not pause.** DevTools → Network → Offline for ~30s with the loop running.
   **Expected:** no pause; you should see the ignored-result log with `status: 0` (fetch path) —
   the loop keeps ticking and resumes cleanly when you go back online.
9. **A non-rate-limit result mid-backoff changes nothing.** Force a 429 (step 3), then while
   still paused force a 404. **Expected:** `backoffUntil`, `backoffStepIndex` and `lastFailureAt`
   are all **unchanged** — the 404 neither extends nor clears the pause. Then remove the
   override: the first 2xx still clears it.
10. **XHR path specifically.** Steps 1 and 3 exercise whichever transport Amazon uses. If the
    board uses `XMLHttpRequest` rather than `fetch` (check the Network panel's *Type* column),
    that is the path that changed from a single `loadend` listener to `load`/`error`/`timeout` —
    confirm both the abort case (step 1) and the 429 case (step 3) on it.
11. **Regression — the page still works.** `networkObserver.js` wraps the page's own
    `fetch`/`XHR` in the MAIN world, so a throw there would break Amazon's site. **Expected:** the
    load board browses, searches, filters and books exactly as normal, with no new errors in the
    page console.

### TC-PANEL-COLOUR-1 — Accordion leg headers are #CFDBFB in light mode, unchanged in night mode

Covers the 2026-07-31 token change (`--ext-leg-header-bg`, `#DCE6E9` → `#CFDBFB`). The CSS-level
half is already verified automatically (21 checks against the real generated stylesheets — see
CHANGELOG.md). **This is the visual half, NOT run.**

1. **Light mode.** Open a multi-leg load's inline panel with night mode OFF. **Expected:** every
   accordion leg header is the light periwinkle `#CFDBFB`. Sample it with the DevTools colour
   picker rather than judging by eye — the previous value `#DCE6E9` is close enough to mistake.
2. **Every leg, both states.** Expand and collapse legs. **Expected:** the colour is identical on
   collapsed and expanded headers, and on every leg of a 3+ leg load — no odd one out.
3. **Night mode unchanged — the main risk.** Toggle night mode ON with the panel open.
   **Expected:** headers go to the dark elevation colour exactly as before; `#CFDBFB` must appear
   **nowhere**. Toggle back and forth a few times, and also open a fresh panel while already in
   night mode (a different code path from toggling with it open).
4. **Contrast — the known regression.** On a light-mode header, look at the distance/duration
   text, the connecting route arrow, and the chevron (all `#4A6570`). **Expected:** legible, but
   be aware they now measure **4.48:1**, just under WCAG AA's 4.5:1 (was 4.88:1). If they read as
   washed out to you, the one-line fix is `#4A6570` → `#49646F` in `inlinePanel.js:173/178/200` —
   see CHANGELOG.md. The station codes (`#1F3A45`) are unaffected at 8.68:1.
5. **Pills still stand out.** The Loaded / Empty pills sit on the new background. **Expected:**
   still clearly distinguishable from the header behind them — their separation ratio improved
   slightly, but confirm visually since it is a low ratio either way (~1.2:1) by design.
6. **Regression — nothing else moved.** Column alignment between the leg header and the table
   below it, the header's bottom border (`#C4D2D6`), corner radii, and the card shadow should all
   be exactly as before. This was a colour-only change.

### TC-PANEL-2B — Card click stops auto-refresh even when the refresh detaches the card (2026-07-31)

Regression test for the fix that moved the stop out of `waitForSheet`'s callback. Supplements
TC-PANEL-2 (which covers the basic case). Automated coverage: 24 checks incl. a mechanism proof
with a detached card — see CHANGELOG.md. **Browser half NOT run.**

1. **The reported case.** Start auto-refresh and let it run at a **fast interval (0.5–1s)** — the
   faster the refresh, the more reliably Amazon re-renders the list and detaches the card, which
   is what triggered the bug. Click any load card. **Expected:** the loop stops immediately —
   the sidebar play/pause flips to paused and no further refresh occurs.
2. **Watch for the fingerprint of the old bug.** Set `DEBUG_LEVEL = 4` in `utils/constants.js`
   (it ships as **1**, at which none of these `logger.log` lines are visible at all). **Expected:**
   `manual card open — stopping loop for dispatcher review` appears. If you instead see
   `waitForSheet: card no longer the one being waited on — discarding result` *without* the stop
   line, the regression is back.
3. **Repeat 10×.** Click a card, restart the loop, click another card. **Expected:** stops every
   single time — the old bug was timing-dependent, so one success proves little.
4. **(b) Stays stopped after closing the panel.** Close the inline panel (click the same card
   again). **Expected:** the loop stays stopped — it must **not** auto-resume.
5. **(c) Restart works.** Press play. **Expected:** refreshing resumes normally.
6. **(d) Click while already stopped.** With the loop stopped, click a card. **Expected:** panel
   opens, nothing else changes, no error.
7. **Regression — the panel still shows the RIGHT load.** This is what guard 3 protects and it
   must still work: click card A, then quickly click card B before A's panel renders.
   **Expected:** the panel shows **B's** data, never A's. Repeat a few times at speed. Then
   confirm a PAT post created from that panel carries B's load.
8. **Regression — slow sheet.** Click a card and let Amazon's sheet load slowly (throttle the
   network). **Expected:** the loop stops immediately on the click, not only when the sheet
   finishes; the panel appears when the sheet is ready.

### TC-ORIGIN-1 — Active origin cities panel (2026-08-05)

Covers `content/originCities.js`. Logic verified automatically (44 checks — see CHANGELOG.md),
but **against a stub DOM: whether Amazon's real chips actually contain a `<span>` whose text
starts with `"Origin city: "` has never been checked in a browser.** That is what step 1 is for.

Set `DEBUG_LEVEL = 4` in `utils/constants.js` first, or none of the log lines appear.

1. **Verify the extraction assumption FIRST.** With one or more origin cities in the Relay
   filters, run in the console:
   ```js
   [...document.querySelectorAll('span')]
     .map(s => s.textContent.trim())
     .filter(t => t.startsWith('Origin city: '))
   ```
   **Expected:** one entry per active origin city, e.g. `["Origin city: LITTLE ROCK, AR"]`.
   **If this returns `[]`, the whole feature is built on a wrong assumption — report the actual
   chip text and stop.** Note the value may include a state suffix or trailing spaces; both are
   handled, but report what you actually see.
2. **Panel appears, positioned and laid out correctly.** *(Supersedes BOTH earlier versions of
   this step — the bottom-left panel and the below-the-chips panel. Neither placement is current.)*
   Log in, open the load board. **Expected:** the panel sits **to the RIGHT of Amazon's
   "Showing N results" text, about 16px clear of it, vertically centred on that row** — above the
   chip band, not below it. Cities run **horizontally in one row**, caption **inline at the left**
   of that same row. No `Origin city:` prefix on the pills.
3. **Add a city.** Add a second origin in Relay's filters. **Expected:** the panel gains that row
   within ~½ second, no page reload. Console: `origin city list changed — re-rendering`.
4. **Remove a city.** Remove one. **Expected:** the row disappears. Remove them all: the panel
   stays visible and shows "No origin cities in filters".
5. **No feedback loop.** Leave the board idle for a minute with the panel showing. **Expected:**
   **no repeating** `re-rendering` lines in the console. A stream of them means the self-trigger
   guard has failed and the observer is looping on our own render.
6. **⚠️ Overlap — judgement calls, not pass/fail.** *(Supersedes the earlier "covers a load card"
   step — the anchor moved above the chips, so that specific problem should be gone. Confirm it
   is.)* Check each:
   - **Load cards** — should now be clear. If the panel still covers the first card, report it.
   - **Chip band** — in the narrow/BELOW branch (step 6b) the panel lands at `row.bottom + 6px`,
     which is where the chips are. **Expected to overlap there.** Decide whether that is
     acceptable.
   - **Sort control** — **unverified.** If Amazon's sort dropdown sits in the same row to the
     right of "Showing N results", the panel will cover it. **Report what you see** — its
     position has never been captured.
   - Sidebar (top-centre) and the bottom-right refresh control should both be clear. Check at
     150% zoom too.
6a. **⭐ Collapse/expand the left filter panel — the reason for the rewrite.** With the panel
   visible, collapse Amazon's left filter panel, then expand it again. **Expected: the panel
   TRAVELS with the reflowing content, smoothly.** It must **not** stay put and then jump into
   position once the animation finishes. A visible snap means the rAF loop is not running —
   report it. Do this several times, and watch the panel rather than the board.
6b. **Narrow window forces the BELOW branch.** Shrink the window until under ~200px of free space
   remains to the right of "Showing N results". **Expected:** the panel drops to just under that
   row and left-aligns with it, instead of being pushed off-screen to the right. Console logs
   `panel placement branch { mode: "below" }`. Widen again: it returns to `"beside"`. Confirm the
   branch logs appear once per transition, **not** repeatedly.
6c. **Anchor-not-found fallback.** In DevTools, edit or delete the "Showing N results" text.
   **Expected:** the panel moves to the top-left corner (`top:8px / left:8px`), the console shows
   `results-count text not found — using fallback position` with the pattern, and — importantly —
   **that warning appears once, not on every frame.** A flood of warnings means the
   log-on-transition guard failed.
6e. **⭐ Refresh must NOT make the panel flash to the corner (fixed 2026-08-05).** Start the loop
   and let it refresh several times — or press Amazon's own refresh control repeatedly. **Watch
   the panel, not the board.** **Expected: it stays exactly where it is.** Amazon clears the load
   list on each refresh, which briefly removes the "Showing N results" row the panel anchors to;
   the panel now holds its last measured position through that gap instead of jumping to the
   top-left corner and back. **Any flash to the corner is a regression — report it.** At
   `DEBUG_LEVEL = 4` you should see `anchor missing — holding last measured position` **once per
   gap**, and **no** `results-count text not found` warning.
6f. **First-ever paint still uses the corner fallback.** Load the board somewhere the results-count
   row genuinely never appears (e.g. a filter combination returning nothing, or delete the text in
   DevTools before the panel first measures). **Expected:** the panel sits at the top-left corner
   with the `results-count text not found — using fallback position` warning — that path is
   intentionally preserved. Then make the row appear: **expected**, the panel leaves the corner and
   anchors properly. It must not hold the corner position.
6g. **Logout → login does not restore a stale position.** Note where the panel sits, log out, scroll
   the board somewhere different, then log back in. **Expected:** the panel re-measures from
   scratch — it must not reappear at its pre-logout coordinates.
6d. **Teardown leaves no CPU running.** With the panel visible, open DevTools → Performance,
   record ~5 seconds, and note the frame activity. Log out via the popup, then record again.
   **Expected:** the per-frame callback is completely gone after logout — no residual ~60fps
   work. This is the specific risk of a rAF loop, and the reason teardown cancels it.
7. **Night mode.** Toggle night mode. **Expected:** the panel follows the dark palette (it uses
   `--ext-*` tokens). `content/nightMode.js` was not modified, so this is the check that the
   token approach actually worked.
8. **Teardown on logout — the regression risk.** Log out via the popup. **Expected:** the panel
   disappears **completely**, along with its `<style>`. Confirm in DevTools that
   `document.getElementById('ext-origin-cities')` is `null` and no
   `ext-origin-cities-style` remains. Log back in: the panel returns, once, correctly populated.
9. **Existing functionality intact.** Sidebar appears and Play/Pause works; the loop refreshes;
   clicking a card still stops the loop and opens the inline panel; the PAT modal still opens.
   **Expected:** all unchanged.
10. **Failure mode is graceful.** In DevTools delete every filter chip from the DOM, then press
    START. **Expected:** the panel shows the empty message and the loop still starts normally —
    the panel must never block activation.

### TC-ORIGIN-2 — Driver-name renaming in the origin-cities panel (2026-08-05)

> ## ⏸️ STEPS 1–9 ARE PENDING RE-WIRING (2026-08-05) — do not run them yet
>
> The click that opened the rename input was **disconnected**, not deleted: that click is
> reserved for per-city filtering in a later task. Renaming is currently unreachable, so
> steps 1–9 below cannot pass and are **not failures**. They are kept verbatim because the
> rename code, its storage and the stored names are all still present and callable — restoring
> the click listener, the Enter/Space keydown listener and the two-line render makes these
> steps live again exactly as written.
>
> **Run steps 0a, 0b, 10–13 now.** Steps 10–13 still apply: the storage layer is untouched.

**0a. ⭐ A single click does NOTHING.** Click a city button. **Expected: no rename input appears,
nothing expands, the button does not change.** Press Enter and Space with it focused —
**expected: also nothing.** (When filtering is added later, this is the click it will use.)

**0b. ⭐ Buttons are comfortable to hit.** **Expected:** each city button is noticeably larger
than before — 14px text with generous padding, roughly 35px tall and about 28px wider than its
text. Click each one several times **near its edges**, not just the centre; you should not have
to aim. Also confirm each shows the **plain city string** — if you had named a driver earlier,
the name does **not** show now (it is still stored and will return when renaming is re-wired).

Covers the rename feature. Logic verified automatically (60 checks originally, plus 41 for the
disconnect/sizing change — see CHANGELOG.md) but **against a stub DOM and stub storage: no real
click, focus, blur or `chrome.storage` call has ever run.** Set `DEBUG_LEVEL = 4` first.

1. **Name a city.** Click a city pill. **Expected:** it becomes a text input, focused, with the
   text selected, placeholder = the city. Type `Mike`, press **Enter**. The pill now shows
   **Mike** as the main label with **the city still visible beneath it**, smaller and grey.
2. **The city text must never disappear.** Confirm on every named pill. If a name replaces the
   city outright, that is a failure — the dispatcher has to know which city it belongs to.
3. **Name persists across reload.** Press F5. **Expected:** the name is there on first paint —
   **no flash of the raw city name that then swaps.** Watch the moment the panel appears.
4. **Escape cancels without saving.** Click a named pill, change the text to something else,
   press **Escape**. **Expected:** the previous name returns, unchanged. Reload: still the old
   name. Nothing was written.
5. **Blur commits.** Click a pill, type a name, then click elsewhere on the page. **Expected:**
   the name is saved. Then repeat with **Escape** and click away — **Expected:** still cancelled,
   the blur must not resurrect the abandoned value.
6. **Empty clears.** Click a named pill, delete all the text, press Enter. **Expected:** the pill
   reverts to plain city text. Reload: still plain.
7. **⭐ Typing does not trigger Amazon's shortcuts.** With the input open, type a name containing
   letters Amazon may bind — try `r`, `f`, `/`, `?`, and press space and arrow keys.
   **Expected:** the characters land in the input and **nothing happens on the board** — no
   refresh, no search box opening, no filter panel toggling, no scroll jump. This is the check
   that the key-event containment works.
8. **Mid-edit board refresh.** Open the input, type half a name, and wait for the loop to refresh
   the board (or press Start and let a tick land). **Expected:** the input stays open with the
   typed text intact — it must not be destroyed and re-rendered under your cursor.
9. **Long name.** Enter a 24-character name, then try to type more. **Expected:** input stops at
   24. The pill widens; if the row runs out of width the pills **wrap to a second line and the
   panel grows** — it should not truncate or run off-screen.
10. **Name follows the city, not the tab.** Name a city in one tab. Open a second Relay tab whose
    filters include the same city. **Expected:** the second tab shows the name. **Known
    behaviour:** a tab that was *already open* will not repaint until its own filter list changes
    or it is reloaded — that is expected, not a bug.
11. **City leaves the filters.** Remove a named city from Amazon's filters. **Expected:** the pill
    disappears. Add the city back. **Expected:** the name is still there.
12. **Reset to Defaults does not wipe names.** Popup → Reset to Defaults. **Expected:** driver
    names survive. (They are stored outside `STORAGE_KEYS` precisely for this.)
13. **Logout leaves nothing behind.** Log out. **Expected:** the panel and its `<style>` are gone
    and no rAF work remains (TC-ORIGIN-1 step 6d). Log back in: names reappear.

### TC-FILTERS-1 — Filters panel collapses on START; already-collapsed does nothing at all

**Rewritten 2026-08-05 (later). Supersedes the earlier version entirely** — that one described a
layout-measurement implementation that clicked twice and expected the panel to "flicker open and
shut". That behaviour was the reason it was rejected and the code is gone. **If you see any
flicker, this test has failed.**

Decision logic verified automatically (38 checks — see CHANGELOG.md), but **only against a
stubbed DOM. Whether `div.filters__column` is really the panel's container on the live board has
never been checked in a browser** — that is the assumption this test exists to confirm.

Set `DEBUG_LEVEL = 4` in `utils/constants.js` first, or none of the log lines below will appear
(the shipped level is 1).

1. **Panel OPEN → collapses.** Open the filters panel, press **START**. **Expected:** the panel
   collapses. Console: `filters panel collapsed` with `intent: "CLOSE_FILTER_PANEL"`. Exactly one
   click — the panel must not reopen a moment later.
2. **Panel ALREADY COLLAPSED → nothing happens. This is the point of the rewrite.** Collapse the
   panel by hand, press START. **Expected:** **absolutely no visual change — no flash, no
   flicker, no momentary open.** Console: `filters panel already collapsed — nothing to do`, and
   crucially **no click is issued at all**. Watch closely: the old implementation's failure was
   exactly a brief open-then-shut here, and it is the single most important thing to confirm.
3. **Stop / pause / resume → panel untouched.** With the panel collapsed from step 1: press STOP,
   then pause and resume via the sidebar, then STOP again. **Expected:** the panel is never
   reopened and never re-collapsed by us at any of those transitions — only START acts. Then
   press START again: expect step 2's behaviour (already collapsed, no click).
4. **Button missing → logged, START still works.** In DevTools delete the
   `<span role="img" aria-label="Filter  ">` from the Filter button while the panel is **open**,
   then press START. **Expected:** `panel is open but Filter button not found — skipping` with
   `labelledIcons` count, no click, **and the loop starts and refreshes normally.** This must
   never block START.
5. **Verify the selector assumption — do this once, first.** With the panel open, run
   `document.querySelectorAll('div.filters__column').length` in the console: expect **1**.
   Collapse it by hand and run it again: expect **0**. **If it is not 0/1, the whole approach is
   wrong and steps 1–4 will misbehave — report the actual value.**
6. **Regression — the detail sheet still closes.** Open a load's detail sheet, press START.
   **Expected:** the sheet closes as before. It shares `closePanelsForStart()` with this feature,
   and a filters failure must not prevent it.

### TC-PANEL-COLOUR-2 — #F5F5F5 on the segment HEADER; body back to #FFFFFF

**Rewritten 2026-07-31 (later).** The earlier version of this test described `#F5F5F5` on
`.ext-seg-body` — that was the wrong surface and has been moved. Steps below describe the
current state. CSS-level half verified automatically (6 structural checks + a full contrast
recompute — see CHANGELOG.md). **Visual half NOT run.**

1. **Light mode — the header is the changed surface.** Open the inline panel on a multi-segment
   load, night mode OFF. **Expected:** each segment header is `#F5F5F5`. Sample with the DevTools
   colour picker — it is close to both the old `#CFDBFB` neighbours and to white, so judging by
   eye is unreliable.
2. **The body is white again.** Expand a leg. **Expected:** the surface behind the stop rows is
   `#FFFFFF`, not the grey it briefly was.
3. **⚠️ The header/body seam is the thing most likely to look wrong now.** `#F5F5F5` header
   against `#FFFFFF` body measures only **1.090:1** — the blue header used to read as an obvious
   band and no longer does. **Expected:** the `border-bottom:1px solid #C4D2D6` still makes the
   header read as a header. **If it now looks like one flat undifferentiated block, say so** —
   that is a design call, not a bug, and it was outside this change's scope.
4. **Zebra striping — restored, but still subtle.** Even rows are `var(--ext-n100)` = `#f5f7fa`
   on the white body: **1.073:1**, back to its original designed value (it was 1.016:1 while the
   body was grey). **Expected:** faint banding, visible in a run of rows. Do not expect obvious
   stripes — it has never been a high-contrast treatment.
5. **Night mode unchanged — check both entry paths.** Toggle night mode ON with a leg expanded,
   and separately open a fresh panel while already dark (different code path). **Expected:**
   headers and body both show the usual dark elevation colours; **`#F5F5F5` appears nowhere**.
   `content/nightMode.js` was not touched; it overrides both selectors with `!important`.
6. **Contrast spot-check — two prior failures should now be gone.** On a header, the
   distance/duration text and the chevron (`#4A6570`) now measure 5.69:1 (were 4.48:1, below the
   4.5:1 bar). In the body, the stop address (`#6B7280`) is back to 4.83:1 (was 4.43:1).
   **Expected:** both read comfortably.
7. **Regression — layout untouched.** Column alignment between header and table, padding,
   borders, corner radii and the card shadow all as before. This was a colour-only change.

### TC-PARSE-2 — Payout parses in the "Similar matches" section (2026-07-31)

Regression test for the two-class payout selector. Parser-level half verified automatically
(25 checks against both real markup shapes — see CHANGELOG.md). **Browser half NOT run.**

1. **The reported case.** Scroll to a board view showing a **Similar matches** section. Open the
   PAT modal (Create Post) from one of those cards. **Expected:** Payout is prefilled with the
   board payout × 1.10, not empty, and Confirm is enabled. Before this fix the field was empty
   with a warning.
2. **Cross-check the number.** Compare the prefilled Payout against the card's own figure ×1.10
   (e.g. `$309.08` → `$339.99`). **Expected:** they match — this catches the selector grabbing
   the wrong element rather than merely a non-null one.
3. **Main list unchanged.** Do the same from an ordinary (non-Similar-matches) card.
   **Expected:** identical behaviour to before.
4. **The guard still holds.** Find or force a card with no readable payout (DevTools: delete the
   payout span from a card, then open the modal). **Expected:** Payout **empty**, warning shown,
   Confirm **blocked**. This must not have been weakened.
5. **⚠ Price-increase loads — known gap, expected to still fail.** Find a load showing Amazon's
   price-increase highlight (`.wo-total_payout__modified-load-increase-attr`). **Expected today:**
   payout may still be empty. **Please capture that card's inner HTML** — whether that class sits
   on the payout span or a sibling badge decides a one-token follow-up fix. See
   AMAZON_SELECTORS.md "Payout inner-class family".
6. **Other fields in that section.** On a Similar-matches card, check equipment, loading type,
   deadhead, trailer letter and tag in the inline panel. **Expected:** populated as usual. These
   use non-`wo-*` selectors that no capture covers, so they are the next most likely silent gap.

### TC-CAPTURE-1 — Flag-gated response-body capture is harmless on a live board (2026-07-31)

**This is the whole point of the feature: prove the body read does not break Amazon's board.**
Logic verified automatically (38 checks against the real `Response` implementation and the real
307 kB capture — see CHANGELOG.md). **The live-board half is what follows, and it has NOT been
run.** Nothing may depend on this capture until step 4 passes.

**Part A — shipped state (flag OFF). Do this first.**
1. Load the extension unmodified. Browse the load board normally for several minutes: search,
   switch saved searches, scroll, open loads, start/stop auto-refresh. **Expected:** everything
   behaves exactly as before. Zero `response captured` lines in the console at any
   `DEBUG_LEVEL`. The rate-limit backoff still works (force a 429/503 per TC-RATELIMIT-7).

**Part B — flag ON. Remember it is a TWO-FILE edit.**
2. Set `CAPTURE_RESPONSES = true` in **both** `utils/constants.js` **and**
   `content/networkObserver.js`, and set `DEBUG_LEVEL = 4`. Reload the extension and the board.
3. **The board must still work.** This is the risk the whole exercise exists to retire.
   **Expected:** loads render, filters apply, saved searches switch, infinite scroll loads more,
   the detail sheet opens. **Watch the page console for
   `TypeError: ... body stream already read` or `body used already` — if that appears, the
   capture is unsafe and must go straight back off.**
4. **Summary lines appear.** **Expected:** one `[EXT][…][networkObserver] response captured (dev
   switch)` per search/similar response, carrying only `endpoint`, `workOpportunities`,
   `totalResultsSize`, `nextItemToken`, `bodyLength`. Cross-check one against DevTools →
   Network → that response's size and JSON. **Confirm there are no ids, cities, addresses or
   payouts on the line.**
5. **Both endpoints.** Trigger a Similar-matches section. **Expected:** a summary with
   `endpoint: "similar"` — and confirm in the service-worker console that `/similar` did **not**
   produce a rate-limit report (only `/search` should).
6. **Aborts stay silent.** Switch saved searches rapidly. **Expected:** no summary for the
   aborted requests, and no spurious rate-limit pause (TC-RATELIMIT-7 step 1 still holds).
7. **Memory.** Watch the sidebar memory dot over ~15 minutes of active use with capture ON.
   **Expected:** no faster growth than with it off. A cloned-but-unread body would show here;
   `.text()` is meant to prevent that.
8. **Turn it back OFF** in both files before any commit or build. Re-run step 1.

**If step 3 shows a body-stream error, stop and report it** — that kills the JSON path entirely,
which is exactly what this test exists to discover cheaply.

### TC-PANEL-POLISH-3 — Full-width action bar, light leg-header colour, fixed-column route alignment

CSS-only pass (2026-07-30, later same day than TC-PANEL-POLISH-2) over `.ext-action-bar`,
`.ext-seg-header`, and `.ext-seg-route` — see CHANGELOG.md for the full before/after,
including the exact hex values and the two required `nightMode.js` additions.

**Automated coverage already run (no browser in the build environment):** 44/44 on a harness
that runs the real `injectPanelStyle()`/`buildNightCss()` and asserts on the generated CSS
string — every color on the correct selector, the grid template and margin math, every
child's exact grid placement, the dead-rule removal, and a simulated-cascade proof that both
new `nightMode.js` overrides actually beat their light-mode counterpart rather than merely
existing somewhere. **None of this is visual proof** — layout/alignment/contrast must be
checked in an actual browser. Requires a **multi-segment (3+ leg) load with mixed-length
city names** (e.g. one leg "OH → GAHANNA, OH" alongside one with two short codes) — the
whole point of the route-alignment fix only shows up under exactly that condition.

1. **Action bar reaches the card edges.** Open any inline panel, scroll to the bottom grey
   icon bar. **Expected:** the grey background now runs edge-to-edge with the card (no
   longer inset ~10-15px on either side); bottom corners still match the card's rounding.
2. **First icon sits 16px from the left edge.** **Expected:** the screenshot icon (first of
   the three) starts at the same horizontal x-position as the header/body/table content
   above it (all inset 16px), not flush against the very edge.
3. **Right edge — note, not a bug report.** With Fast Book visible (a load where it's
   enabled), confirm it now sits flush against the card's right edge with no gutter (this is
   the flagged, not-explicitly-requested trade-off in CHANGELOG.md — confirm it's visually
   acceptable, or flag if symmetric spacing is wanted).
4. **Leg header colour.** Collapse a segment (or view a header not currently expanded).
   **Expected:** background is a light, soft grey-blue-green (not white, not the old dark
   navy), with a thin, slightly darker bottom edge line separating it from whatever is below.
5. **Leg header text/icon contrast.** On that same light header: the route codes (e.g. "OH",
   "GAHANNA, OH") are dark, bold, and easily readable; the distance/duration text is a
   visibly lighter/secondary grey-blue than the route codes (not the same weight); the
   collapse/expand chevron on the far right is visible and roughly the same secondary tone
   as the distance text — none of the text is white-on-light (the old white text would be
   near-invisible now if this regressed).
6. **Status pills still readable.** Loaded (green), Empty (grey), Live/Drop (blue) pills
   still show their own pill background clearly against the new lighter header — **this is
   a flagged manual check**: the Empty pill in particular (`#F3F4F6` bg) is close in
   lightness to the new header (`#DCE6E9`) and may look washed out or borderless; report if
   it's hard to distinguish where the pill ends and the header begins.
7. **Arrows line up in one vertical column — the core fix.** On a 3+ leg load where leg
   names differ substantially in length (short "OH" vs long "GAHANNA, OH"), collapse all
   headers and look straight down the stack. **Expected:** the "→" between origin and
   destination sits at the EXACT same x-position in every leg, regardless of how long or
   short the adjacent city names are — this was the reported bug (arrows drifting leg to
   leg) and is what the fixed 170/28/170px grid is specifically for.
8. **Long city names truncate, don't wrap or overflow.** Find or note a leg with a long
   destination name (e.g. "GAHANNA, OH"). **Expected:** the text stays on ONE line and ends
   in an ellipsis (…) if it doesn't fit in its cell — it must NOT wrap to a second line
   (that would push the row's height and misalign it against neighboring legs) and must NOT
   visibly overflow past its column into the arrow's space.
9. **Badge alignment.** Across the same multi-leg load, confirm the small circular stop-
   number badges (before each code) also land in one consistent vertical column on both the
   origin side and the destination side — not just the arrows.
10. **40px left indent.** Compare the route group's start position against the header's own
    edge. **Expected:** noticeably more inset than the icons in row 1 of the top sidebar bar
    or other 16px-inset content — the route group now starts ~40px from the card's left
    edge, not 16px.
11. **Narrow-card check (flagged architectural trade-off).** Shrink the browser window (or
    view on a smaller display) until the load-board cards are noticeably narrower — ideally
    below ~1150-1200px card width. **Expected finding, not necessarily a bug:** the route
    group's fixed 368px+24px-indent content may start overlapping the distance/duration or
    status-pill columns to its right, since those still flex with the header's percentage
    grid while the route group no longer does. Report exactly how narrow it gets before this
    happens, so it's known whether real-world card widths ever hit it.
12. **Regression — Night Mode.** Toggle Night Mode on, repeat steps 4-10. **Expected:**
    header background/border return to the existing dark elevation ramp (unaffected by
    today's light-mode color, since nightMode.js's `!important` overrides always win); route
    codes and chevron read as primary/muted dark-mode text respectively, NOT as the light
    mode's `#1F3A45`/`#4A6570` hex bleeding through — if either looks like a dark, low-
    contrast smudge against the dark header, the corresponding `nightMode.js` override
    (`.ext-route-origin`/`.ext-route-dest`, or the chevron) isn't taking effect.
13. **Regression — no HTML/JS behavior change.** Segment header click still expands/
    collapses (chevron rotates), Fast Book and the three icon buttons still work, single-
    segment loads render normally. This was a CSS-only pass — no `buildPanelElement()` or
    `buildActionBar()` changes.

### TC-PAT-4 — Unreadable distance / stop count block Confirm (no fabricated post)

Fixes the audit's top finding: an unreadable board distance used to prefill Min/Max Miles as
**0 / 25**, and an unreadable stop count as **0 Stops**, and both were posted to the live
marketplace with no warning and no gating. Same no-silent-fallback rule as Payout (TC-PAT-2)
and load times.

**Automated coverage already run (2026-07-30, no browser available):** 66/66 in a Node
sandbox against the real extracted `parsePatMilesOrNull()` plus the gate/submit logic —
sentinel behaviour (incl. genuine `"0 mi"` → 0 vs `"n/a"` → null), empty Min/Max on failure,
stop count NaN/<1 → null, Confirm disabled per failure mode and re-enabled after valid manual
entry, payload carrying the typed value, and no regression to the payout/times/blockingErrors
gates. **The DOM rendering and live submit below are NOT covered by that** — they need a
browser and a real load.

**Setup:** log in, open the load board, open a load's inline panel, click the Create Post
(document) icon in the bottom action bar to open the PAT modal.

1. **Healthy load — regression baseline.** Open the modal for a load whose distance and stop
   count both read normally. **Expected:** Min/Max Miles prefilled to (distance − 25) and
   (distance + 25); Stops shows the read-only text (e.g. "3 Stops") exactly as before; no new
   warning text anywhere; Confirm enables once cities resolve. **Nothing about this path
   should look different from before the fix.**
2. **Unreadable distance.** Reproduce by opening the modal for a load whose distance is
   missing/garbled (if none occurs naturally, temporarily stub `loadUnit.distance` to `'n/a'`
   via the console before opening). **Expected:** Min Miles and Max Miles are **empty** — not
   0 and 25 — and a red line reading exactly *"Load distance could not be read — enter it
   manually"* appears under Min Miles. Confirm is **disabled** even with cities resolved, a
   valid payout, and valid times.
3. **Distance — manual entry unblocks.** With the modal from step 2: type Min = 80, leave Max
   empty → Confirm **stays disabled**. Type Max = 60 (less than Min) → **stays disabled**.
   Type Max = 130 → Confirm **enables** and the red distance line **disappears**.
4. **Unreadable stop count.** Open the modal for a load whose stop count is missing/garbled
   (stub `detail.header.stopsCount` to `''` if needed). **Expected:** the Stops field is a
   **number input**, not the read-only "0 Stops" text, and a red line reading *"Stop count
   could not be read — enter it manually"* appears beneath it. Confirm **disabled**.
5. **Stops — manual entry unblocks.** In step 4's modal: type `0` → Confirm **stays
   disabled** (a zero-stop post is not a real load). Type letters → **stays disabled**. Type
   `3` → Confirm **enables**, red line **disappears**.
6. **Both unreadable at once.** With both stubbed: Confirm disabled and **both** warnings
   visible. Fixing only one leaves Confirm disabled; fixing both enables it.
7. **Submitted payload is the typed value.** After fixing step 6 manually (Stops 2, Min 80,
   Max 130), click Confirm and inspect the outgoing `/api/loadboard/orders/upsert` request in
   DevTools → Network. **Expected:** `stopCount` is **2** and the miles are 80/130 — the
   typed values. **Critically: `stopCount` must never be 0 and miles must never be 0/25.**
8. **Cleared-but-healthy field shows no false warning.** On a healthy load (step 1), manually
   clear Min Miles. **Expected:** Confirm disables, but the "could not be read" line does
   **not** appear — the board data was fine, so that message would be a lie. Re-typing a
   value re-enables Confirm.
9. **Regression — existing gates.** On a healthy load, confirm the pre-existing gates still
   behave: clearing Payout disables Confirm and shows the payout warning; an unset start/end
   time disables Confirm and shows the times warning; a load with an unknown loading type or
   unrecognized timezone still shows its permanent blocking error and never enables Confirm.
10. **Regression — Night Mode.** Repeat steps 2 and 4 with Night Mode on. **Expected:** both
    new warning lines are legible against the dark modal (they reuse the existing
    `.pat-payout-warning` red, which has no dark-mode override — flag if unreadable; the PAT
    modal's separate dark palette is a known open audit finding).

### TC-PANEL-RACE-1 — Rapid card switching never renders the wrong load's data

Fixes the audit finding that `waitForSheet()` left one poller alive per click. Clicking card A
then quickly card B rendered **card A's panel from card B's sheet data** — and merged that data
into `loadStore` under A's `loadId`, so a PAT post created from it would carry the wrong load
entirely. This is a correctness-of-data bug, not a cosmetic one.

**Automated coverage already run (2026-07-30, no browser available):** 31/31 in a Node sandbox
driving the real extracted `waitForSheet()`/`cancelSheetPoll()` on a controllable clock —
the A-then-B interleaving, the queued-stale-tick race, card detachment/identity discards,
teardown cancellation, and timeout cleanup. **The same scenario was replayed against the
pre-fix function and reproduces the bug**, so the test is known to detect it. What follows is
the real-browser half, which the sandbox cannot cover: Amazon's actual sheet-swap timing.

**Setup:** log in, open the load board with at least 3 loads whose payouts/stop counts differ
visibly (so a wrong render is obvious at a glance). Extension may be running or paused.

1. **Baseline — single click.** Click one card, wait for the panel. **Expected:** the panel's
   route, stops, and payout match that card. Unchanged from before the fix.
2. **The race — two fast clicks.** Click card A, then click card B **within ~200ms** (before
   A's panel appears). **Expected:** exactly one panel appears, attached to **card B**, showing
   **B's** data. There must be no flash of a panel under card A, and no panel that shows B's
   numbers under A's position. Repeat 5–10 times with varying gaps (~50ms, ~150ms, ~400ms,
   ~900ms) — the ~50–300ms window is where the old bug reproduced most reliably.
3. **Three fast clicks.** Click A → B → C in quick succession. **Expected:** one panel only,
   under C, with C's data. No orphaned panels under A or B.
4. **Cross-check the stored data (the part that actually mattered).** After step 2, open the
   PAT modal from the rendered panel's Create Post icon. **Expected:** origin/destination,
   distance, and stop count match **card B** — the card the panel is attached to. Before the
   fix this could show A's identity with B's numbers. Cancel the modal; do not submit.
5. **Slow alternating clicks — regression.** Click A, let its panel fully render, then click B,
   let it render, then A again. **Expected:** each click produces the correct panel for that
   card; clicking a card whose panel is already open still closes it (toggle-off unaffected).
6. **Logout mid-poll.** Click a card and, within the ~1.5s poll window, log out via the popup.
   **Expected:** no panel ever appears, and none appears late (wait ~5s). The sidebar and all
   extension DOM are removed as usual.
7. **Auto-open path — regression.** Start the loop and let it auto-open a new load.
   **Expected:** the panel renders as before with correct data; this path does not go through
   `waitForSheet`, so it should be entirely unaffected — confirm it did not regress.
8. **Sheet that never loads (timeout).** Click a card while offline / with
   `/api/loadboard/search` blocked in DevTools, so the detail sheet never renders.
   **Expected:** after ~1.5s the poller stops; either no panel or a panel with no segments,
   and — critically — **no repeating console output and no leaked interval**. Confirm with
   several such clicks in a row that nothing accumulates.
9. **Console check.** Through all of the above, watch the console for
   `waitForSheet: run superseded — discarding result` / `card no longer the one being waited
   on`. Seeing these during step 2 is **correct** — it is the fix working. Seeing
   `manual toggle render failed` instead would mean a discard path was missed.

### TC-LOG-1 — DEBUG_LEVEL gates every logger method; no PII in the console

Covers two audit findings fixed together on 2026-07-30: `DEBUG_LEVEL` previously gated only
`logger.debug` (≈3% of output), and three sites logged the dispatcher's email / full street
addresses. Shipped default is now `DEBUG_LEVEL = 1` (errors only).

**Automated coverage already run (no browser available):** the real `utils/logger.js` was
loaded into a VM with a captured console and exercised at levels 0–4 (each level emits exactly
the expected channels; level 4 is equivalent to the old behaviour); the missing-constant
fallback and data-less calls were confirmed non-throwing; `parseDetailAddress` was executed
against five real address strings with its log payloads asserted PII-free; and logger call
counts were confirmed identical before/after (303). **None of this ran in a browser** — the
steps below are what must be checked by hand.

**Setup:** load the unpacked extension, open a Relay load board, open devtools console,
filter on `[EXT]`.

1. **Shipped default is quiet.** With `DEBUG_LEVEL = 1` (as committed), reload the page and
   use the extension normally — start/stop the loop, open a card, open the PAT modal.
   **Expected:** the `[EXT]` console is essentially empty. Only `console.error` lines appear,
   and only if something actually failed. This is the state a Web Store reviewer sees.
2. **Nothing broke from the silence.** Same session as step 1: confirm the sidebar builds,
   the loop runs, cards open, the inline panel renders, the PAT modal opens and Confirm
   enables. **Silencing logs must not change behaviour** — if any feature misbehaves only at
   level 1, a log call had a side effect and that is a bug.
3. **Level 3 restores the familiar chatter.** Set `DEBUG_LEVEL = 3` in `utils/constants.js`,
   reload the extension. **Expected:** `log` + `warn` + `error` all appear — roughly today's
   pre-fix volume minus debug.
4. **Level 4 shows debug too.** Set `DEBUG_LEVEL = 4`, reload. **Expected:** additionally the
   5 `logger.debug` lines appear (e.g. `getHeapUsageRatio called` every ~7s from the sidebar
   memory poll). This should match old behaviour exactly.
5. **Level 0 is truly silent.** Set `DEBUG_LEVEL = 0`, reload, then force an error (e.g. block
   `/api/loadboard/search` so a fetch fails). **Expected:** no `[EXT]` output at all, not even
   errors.
6. **Level 2.** Set `DEBUG_LEVEL = 2`. **Expected:** warnings and errors, no plain logs.
7. **PII — email never appears.** At **level 4** (worst case), open the popup and run a full
   login: enter email → send code → enter code → verify. Search the console for your email
   address. **Expected: zero hits from `[EXT][popup] signInWithOtp requested` and from
   `[EXT][content] auth gate open`.** Those two lines should show `emailLength` and `hasEmail`
   instead. *(Known and deliberately NOT fixed in this task — `verifyOtp`, `resend
   signInWithOtp`, `restorePendingOrEmailStep`, and `authGate gate transition` still log the
   email; expect hits from those four and ignore them here.)*
8. **PII — street address never appears.** At **level 4**, open the PAT modal for a load whose
   stops have full street addresses. Search the console for the street number, the city name,
   and the postcode. **Expected: zero hits from `[EXT][patApi] parseDetailAddress …`** — it
   must show `hasInput` / `inputLength` / `matched` only. *(Known and NOT fixed here:
   `patModal openPostModal: city source comparison` still logs full addresses, and
   `resolvePATCity` logs city/state — expect hits from those and ignore them here.)*
9. **Diagnostic value retained.** At level 3, open a PAT modal for a load whose address does
   not parse. **Expected:** you can still see that `parseDetailAddress` ran and that it did
   not match (`matched: false`) — enough to debug the failure without the value.
10. **Restore before shipping.** Confirm `utils/constants.js` is back to `DEBUG_LEVEL = 1`
    before any build is packaged.
