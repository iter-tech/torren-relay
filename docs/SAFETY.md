# Safety — Amazon Relay Helper

## Binding safety boundary (permanent, applies to all future features)

This extension interacts with a live commercial booking system. The following rules are non-negotiable and apply to every feature in the backlog:

- The extension CAN execute a booking sequence ONLY when the dispatcher explicitly clicks the custom 'Fast Book' UI toggle/button.
- **`isForbiddenElement()` is called before every `.click()` on Amazon's DOM.**
- None of the planned features (Night Mode, Tab Alert, Sound, Price Surge, Hide filters, Card Action Bar) add any new click site or touch booking.

Separately, `content/sidebar.js` has one click site on our own extension-owned UI (`ext-memory-indicator`, a manual dispatcher-triggered `location.reload()`). It is not Amazon DOM, carries no booking risk, and is intentionally **not** part of the "three click sites" list below — see "Allowed click sites" for the rationale.

---

## FORBIDDEN_SELECTORS (utils/constants.js)

```

```

`isForbiddenElement(el)` returns true if `el` or any ancestor matches any of these selectors. Called before **every** `.click()`.

**NEVER modify or remove these selectors.**

---

## Allowed click sites (Amazon DOM only)

This rule governs clicks on **Amazon's own page DOM**. It does not apply to clicks on
elements the extension itself injects (our own chrome) — see "Extension-owned click" below.

### Click 1 — Refresh button (refreshManager.js → refreshNow())
Three gates must ALL pass:
1. `findRefreshButton()` returns non-null
2. `isForbiddenElement(button)` === false
3. `button.tagName === 'BUTTON'`


Intent logged as `ALLOWED_CLICK_INTENTS.REFRESH`.

### Click 2 — Load card neutral zone (detailOpener.js → openTopNewLoad())
Implementation uses `scrollIntoView` + 250ms `setTimeout` + `document.elementFromPoint`:

Gates on the card container (`el`):
1. `el` exists
2. `isForbiddenElement(el)` === false  **(MANDATORY)**
3. `document.contains(el)` === true
4. **`hasLayoutBox(el)` === true — added 2026-08-20.** A 0x0 card was measured live: the click
   was dispatched at an element with no box, `elementFromPoint` resolved a corner-of-viewport
   element instead, and nothing handled it. No box ⇒ wait one animation frame, **bounded to
   `AUTO_OPEN_LAYOUT_ATTEMPTS = 10`**, then give up cleanly. **Never click an unlaid-out element.**

Gates on the resolved `target` (elementFromPoint result, run inside setTimeout):
5. `target` non-null
6. `isForbiddenElement(target)` === false  **(MANDATORY)**
7. If `target` is outside `el`, fall back to `el` itself
8. **`hasLayoutBox(target)` === true — added 2026-08-20**, same rule, same bound.

Intent logged as `ALLOWED_CLICK_INTENTS.NEUTRAL_ZONE`.

#### ⚠ THE DISPATCH IS A CONSTRUCTED MouseEvent, NOT `.click()` — changed 2026-08-20

It was `target.click()`. `HTMLElement.click()` takes no arguments, so every synthetic click
carried `clientX/clientY = 0` — measured on all five attempts as
`click (0,0) ** OUTSIDE ** the innermost interactive element's box`. Amazon tolerated it three
times out of five. Coordinates cannot be set through `.click()` at all, so the dispatch is now:

```js
var ev = new MouseEvent('click', { view: window, bubbles: true, cancelable: true,
  composed: true, detail: 1, clientX: cx, clientY: cy, screenX: cx, screenY: cy,
  button: 0, buttons: 0 });
target.dispatchEvent(ev);
```

`cx, cy` = the **centre of the resolved target's own box**.

**What did NOT change, and must not:** it is still **exactly ONE click event on ONE element**, it
still passes **every** gate above, and **no `pointerdown`/`mousedown`/`pointerup`/`mouseup`
sequence was added**. This is not a broader interaction — it is the same click with the
coordinates a real one has. `isForbiddenElement()` still runs before it, unchanged.

### Click 3 — Load detail panel close (panelCloser.js → closePanelsForStart())
**Rationale:** Same as Click 3. Closing the load-detail sheet cannot trigger booking.
The detail sheet is `#selected-work-sheet`; its close button contains no booking controls.

**Safety:** `isForbiddenElement()` verifies the close button is not a booking element
before every click.

Gates:
1. `document.querySelector('#selected-work-sheet')` is non-null (panel is open)
2. `findDetailCloseButton()` returns non-null (close button found within sheet)
3. `isForbiddenElement(btn)` === false  **(MANDATORY)**

Intent logged as `ALLOWED_CLICK_INTENTS.CLOSE_DETAIL_PANEL`.
Selector strategy: see AMAZON_SELECTORS.md → Detail panel close.

### Click 4 — Filters panel collapse (panelCloser.js → collapseFilterPanel())

**RESTORED 2026-08-05.** This section was deleted in June 2026 when three attempts at the
feature were abandoned; the feature is back with a different mechanism and is re-authorized here.

**Rationale:** Amazon's own Filter toggle shows/hides the left filters panel. It is a display
control — it books nothing, submits nothing, and changes no load state. Clicking it is
equivalent to the dispatcher clicking it himself.

**Safety:** `isForbiddenElement()` verifies the button is not a booking element before the
click, exactly as every other click site here.

**EXACTLY ONE CLICK, EVER — and only when the panel is confirmed open.** The control is a
toggle carrying no readable state (verified live 2026-08-05: attributes are byte-identical open
vs collapsed, no `aria-expanded` anywhere). But the *panel* does carry state: Amazon **removes
`div.filters__column` from the DOM** when it is collapsed. A single `querySelector` therefore
settles the question before anything is clicked. Absent ⇒ already collapsed ⇒ **return without
clicking**.

**Superseded 2026-08-05 (same day):** the first implementation of this click site measured a
load card's `getBoundingClientRect().left` before and after clicking and issued a **second**
click to undo itself when it guessed wrong. That made the panel visibly flash open and shut
whenever it was already collapsed. It has been deleted. **No layout measurement, no
click-then-verify, and no second click exist on this path any more.** If either reappears, this
section is out of date.

Gates:
1. `document.querySelector('div.filters__column')` is non-null (panel is genuinely open).
   **Absent ⇒ no click at all**
2. A `[role="img"][aria-label]` whose trimmed label is `Filter` exists, and `.closest('button')`
   from it is non-null. **Absent ⇒ no click at all**
3. `isForbiddenElement(btn)` === false  **(MANDATORY)**
4. Fires on loop START only (`tabState 'running'` subscriber, `val === true`). Never on stop,
   pause, resume, or page load. The panel is never reopened automatically.

Intent logged as `ALLOWED_CLICK_INTENTS.CLOSE_FILTER_PANEL`.
Selector strategy: see AMAZON_SELECTORS.md → Filter button.

### Click 5 — Fast Book sequence
Allowed to programmatically execute the booking sequence (including interacting with Amazon's DOM booking buttons) when the user interacts with the extension's explicit 'Fast Book' trigger.
---

## Extension-owned click (not subject to the rule above)

### Memory indicator (content/sidebar.js → `ext-memory-indicator`)
**2026-06-30:** Replaced the automatic memory-watchdog reload (which silently reset
Amazon's own search filters, not restorable without simulating clicks on Amazon's filter
controls — out of scope) with a manual indicator. Clicking it calls `location.reload()`
directly, dispatcher-initiated only — no automatic trigger exists anywhere in the
extension. Target is `ext-memory-indicator`, an element the extension itself created; it
is never Amazon DOM, so `isForbiddenElement()` does not apply and this click is **not**
counted among, or added to, the "three click sites" above.

---

## Network write — PAT order upsert (content/patApi.js + content/patModal.js — 2026-07-06)

The PAT feature makes a **same-origin POST** from a content script to Amazon Relay's internal
order-upsert API. This is not a click site and does not touch Amazon's DOM.

**Safety properties:**
- CSRF token always read live from `<meta name="x-owp-csrf-token">` — never captured, cached, or hardcoded.
- No `.click()` on any Amazon DOM element anywhere in this feature.
- `FORBIDDEN_SELECTORS` and `isForbiddenElement()` are not involved (no DOM clicks).
- No `innerHTML` with page data — all dynamic text via `textContent`.
- No new `manifest.json` permissions required — same-origin fetch needs only `host_permissions`.
- The dispatcher must click **Confirm** in the extension's own modal — there is no auto-submit path.
- `PAT_PAYOUT_MARKUP_RATE = 1.10` (2026-07-20, replaces the earlier flat `PAT_TEST_MARKUP_USD = 5000`): default offer = board payout × 1.10. **This is no longer an "obviously fake price" safety margin** — a 10% markup is a plausible real carrier offer, unlike the old flat +$5000. The dispatcher-must-click-Confirm gate above is now the primary safety control for this feature, not an unrealistic default price. If board payout is missing/unparseable, Payout is left **empty** (no silent fallback value) and Confirm stays disabled until the dispatcher enters a valid amount manually — see `ext-pat-payout-warning` in `content/patModal.js`.
- The POST creates a **carrier offer (truck post)**, not a booking. No load is reserved or booked.
- `FORBIDDEN_SELECTORS` booking-button rule is unrelated and must not be touched.

---

## Scope
- **Load Board (Layout A) only.** `div.load-list:first-of-type` → `div.load-card` / `div.load-card__selected` / `div.wo-card-header--highlighted`.
- Layout B (Contracts / tour-container) is intentionally ignored.

---

## Audit checklist (Stage 17)

- [ ] `isForbiddenElement()` called before every `.click()`
- [ ] No new `.click()` sites introduced by popup wiring (Step 3) or any backlog feature
- [ ] 30-minute live test on Load Board

## Fast Book — THE IDENTITY RULE (added 2026-08-27)

🔑 **FAST BOOK MUST NEVER CLICK BOOK UNLESS THE LOAD OPEN IN AMAZON'S SHEET IS THE LOAD THE
BUTTON IS BOUND TO.**

This is the only place the extension clicks Amazon's real Book button, and it is the only place
that spends the dispatcher's money. The rule is enforced immediately before the dispatch, at
`content/inlinePanel.js`, `executeFastBook()`:

```js
var sheetOpen = sheetOpenLoadId();
var openId    = sheetOpen ? sheetOpen.id : null;
if (!sheetLoadId || !openId || sheetLoadId !== openId) { /* abort, no click */ }
```

### The rule in words

1. **Strict equality on the UUID string.** No normalising, no case folding, no prefix matching.
   Both ids come from the `.id` DOM property of Amazon's own markup, so a difference of any
   kind means the two sides disagree — which is when to abort, not when to paper over.
2. ⚠ **FAIL CLOSED.** Three separate aborts: the ids differ; the **bound** id is missing; the
   **sheet** id is missing. **An absent id NEVER compares equal and is never treated as
   "probably fine."** `sheetOpenLoadId()` returns `id: null` on every failure — no sheet,
   no UUID in it, or an exception — precisely so that callers cannot proceed on an unread sheet.
3. ⚠ **THE ABORT IS VISIBLE.** A silent abort is not acceptable: the dispatcher pressed Fast
   Book and expects a booking, and if nothing happens he presses again. The button is left
   **disabled**, reading **"Blocked — wrong load open"**, carrying a `title` that says what
   to do. It is deliberately **not** reset to "Fast Book" — a button that looks ready to press
   is itself a silent failure.
4. **ONE definition of the id-shape rule.** `sheetOpenLoadId()` is the single implementation;
   `clickDiagSheetLoadId()` delegates to it. ⚠ Three copies of a card lookup have already
   cost this project once — that is not repeated on a booking check.

### The confirm poll

After the Book click, a poll (100 ms, 5 000 ms ceiling) looks for Amazon's confirm button. The
exact-id lookup `#rlb-book-trip-confirm-booking-btn` stays **document-wide**, because the
dialog may be portalled outside the sheet and an exact id cannot match another load's button.

⚠ **The TEXT fallback is scoped to the sheet.** It previously swept
`document.querySelectorAll('button')` across the whole page for five seconds, clicking the
first button whose text was `Book`, `Confirm` or `Confirm booking`. **If the dialog is
ever portalled out AND its id changes, Fast Book now times out instead of guessing.** On a
booking action that is the correct direction to fail: a timeout is recoverable, a wrong click
is not.

⚠ **The poll is cancellable.** Its handle is module-level and `removeInlinePanel()` clears it,
which covers all four `enforcePanelAnchor()` removal sites. A new Fast Book also cancels a
poll still running from an earlier one.

## Fast Book — THE IDENTITY RULE, corrected source (2026-08-27)

⚠ **This SUPERSEDES the source named in the section above.** The rule is unchanged; where the
open load's id comes from has changed, because the original source never worked.

🔑 **FAST BOOK MUST NEVER CLICK BOOK UNLESS THE LOAD AMAZON HAS OPEN IS THE LOAD THE BUTTON IS
BOUND TO.** Two independent gates now stand behind that, and both are checked immediately before
the click, in `content/inlinePanel.js` → `executeFastBook()`.

### ⛔ DEAD HYPOTHESIS — the sheet does not carry the load id

The check originally read the id out of `#selected-work-sheet`. **Measured on a real board
2026-08-27: the sheet contains no UUID anywhere**, in any id or any attribute (see
AMAZON_SELECTORS.md for the eight ids it does contain). So `sheetOpenLoadId()` returned `null`
on every press, and because the guard fails closed by design, **Fast Book was blocked outright —
every press, with `openLoadId: '(missing)'`.**

That is worth stating plainly: **a correct fail-closed guard reading a source that can never
succeed is a permanent outage, and it looked exactly like the guard working.** Hence rule 3 below.

### GATE 1 — identity, from the SELECTED CARD

The open load's id comes from `document.querySelector('.load-card__selected')` and the **existing**
UUID-shape rule (`clickDiagUuidRe()` → cityAssign's `CARD_UUID_RE`).

1. **Strict equality on the UUID string.** No normalising, no case folding, no prefix matching.
2. ⚠ **FAIL CLOSED.** `null` on: no selected card, no UUID under it, **more than one DISTINCT
   UUID**, or any exception. **An absent id never compares equal.** Ambiguity is refused, never
   guessed.
3. ⚠ **`cardLoadIdFor()` IS DELIBERATELY NOT USED HERE.** It falls back to the first `div[id]`
   when no UUID is present — right for *rendering* a panel, wrong for a *booking* gate, where it
   would hand back a badge id and let a press through on an unidentified load.
4. ⚠ **THE SHEET IS STILL REQUIRED.** Only the source of the *id* moved. The sheet is what carries
   the Book button, so its absence still refuses the booking.

### GATE 2 — the payout

The record captured for the bound id carries a payout; Amazon's open sheet prints one. If they
disagree, **abort**. This catches what ids cannot: a stale or mis-keyed record.

- ⚠ **NO LOCALISED WORD IS AN ANCHOR.** It does not look for "Payout" or "Total" — those are
  translated. It parses **amounts only**, and asks whether the record's payout is among them.
- ⚠ **IT ABSTAINS RATHER THAN BLOCKS.** No record, no payout on the record, or nothing parseable
  in the sheet → verdict `abstain`, booking proceeds on gate 1 alone, and **the abstain is
  logged** so it never looks like a pass. **A second line of defence that can itself break
  booking is a liability, not a defence.** It aborts only on a positive contradiction.
- Tolerance is one cent: the record keeps a full float (`668.1707937465877`), the board prints
  `$668.17`.

### 🔴 RULE 3 — A CHANGED AMAZON CLASS MUST BE LOUD

If `.load-card__selected` matches nothing, that is **not** an id mismatch and must never be
reported as one. It gets:

- `logger.error` naming the marker, saying **"EVERY Fast Book press will block"**
- its own outcome `abort-no-marker`
- its own button state — *"Blocked — cannot identify open load"*,
  `data-testid="ext-action-fastbook-blocked-marker"` — whose title says this is an
  extension-side problem that reopening the load will **not** clear

⚠ **A silent permanent block is the defect this exists to prevent.** Three abort states are
deliberately distinguishable: `abort-no-marker` (Amazon changed), `abort-identity` (wrong load
open), `abort-payout` (the money disagrees).

## 🔑 1.0 SHIPS WITH BOOKING UNREACHABLE (2026-08-27)

**`FAST_BOOK_ENABLED = false` in `utils/constants.js`.** In the 1.0 build there is no reachable
path from any UI control, any stored setting, or any console call to Amazon's Book button.

⚠ **THIS IS A BUILD-TIME CONSTANT, NOT A DEFAULT SETTING, AND THE DISTINCTION IS THE ENTIRE
POINT.** The store listing states that the extension does not book loads. For that sentence to be
true it has to be true of the **shipped source**, which a reviewer reads — not merely of the
default value of a toggle that one storage write would flip.

### The three gates, and why there are three

Each of these makes a booking click unreachable **on its own**. They are deliberately redundant:
no single edit, mistake, or leftover listener can re-open the path.

| # | where | what it does |
|---|---|---|
| **1** | `content/inlinePanel.js` → `buildActionBar()` | The Fast Book button is **never created or inserted**. Not hidden, not disabled — absent. `showInlinePanel()`'s wiring block then finds no node, so no click listener is attached either. |
| **2** | `popup/popup.js` (markup wrapped in `popup/popup.html`) | The whole **Booking section is REMOVED from the DOM**, divider and heading included. The toggle cannot be seen, checked, or scripted. |
| **3** | `content/inlinePanel.js` → `executeFastBook()` | **Refuses at entry**, as the first statement, **above every DOM read** — above the sheet lookup and above the rehearsal flag. Returns `'disabled'`. A direct `__EXT_DEBUG` call, a hand-added button, or a stale listener all stop here. |

🔑 **Gate 3 is the one that holds alone under any circumstance**, which is why it sits before any
DOM access rather than merely before the click: so the refusal is true of the whole function, and
the log line "No DOM was read" is a fact rather than a hope.

⚠ **ALL THREE GUARDS FAIL CLOSED ON A MISSING CONSTANT.** Each is written
`typeof FAST_BOOK_ENABLED === 'undefined' || FAST_BOOK_ENABLED !== true`, so a context that never
loaded `utils/constants.js` refuses rather than proceeding. Asserted by `fastbook-suite`.

### What did NOT change

⚠ **Nothing was deleted.** The two-step click sequence, the identity gate, the payout gate, the
rehearsal helpers and the whole of `fastbook-suite` are present and unmodified. The suite runs
with the flag **forced true** so every guard stays covered, and **not one existing assertion was
weakened** to accommodate the gate. Flipping the constant to `true` restores the 2026-08-27
behaviour exactly.

⚠ **THE MANIFEST DESCRIPTION'S TRUTH NOW DEPENDS ON THIS CONSTANT.** They must change together.
See BACKLOG 0ao.
