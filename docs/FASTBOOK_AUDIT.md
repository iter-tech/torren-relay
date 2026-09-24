# Fast Book — audit before re-enabling

**2026-09-24. Code reading only.** Nothing was enabled, nothing was clicked, no Relay page was
opened. Every claim below carries a `file:line` or a `samples/` filename; anything not verified is
marked **[?]**.

> ⚠ This file is the only file this audit created. No existing file was modified.

---

## 1. Where Fast Book is disabled, and how

**One build constant, three independent gates.** `utils/constants.js:152` — `const
FAST_BOOK_ENABLED = false;` with the rationale at `utils/constants.js:128-151`: the store listing
says the extension "does not book loads", and for 1.0 that had to be true of the **shipped source**,
not merely of the default settings.

| Gate | Where | Effect |
|---|---|---|
| 1 | `content/inlinePanel.js:853-860` (`buildActionBar`) | the Fast Book button is never **created** — absent, not hidden, so no click listener is ever attached (`:1551` finds no node) |
| 2 | `popup/popup.js:191-196` | the whole Booking section is **removed** from the popup DOM (`popup/popup.html:206-218`), so the toggle cannot be set |
| 3 | `content/inlinePanel.js:392-399` (`executeFastBook`, first statement) | refuses at **entry**, above every DOM read, so a direct `__EXT_DEBUG` call cannot reach a click |

Each gate uses a `typeof` guard so a context that failed to load `constants.js` fails **closed**.
Nothing was deleted: the two-step click sequence, both identity gates and the rehearsal helpers are
all still present (`utils/constants.js:137-140`).

A second, independent switch exists for when the build flag is true: the **`fastBookEnabled`
storage key** (`utils/storage.js:20`), written by the popup toggle (`popup/popup.js:676`) and read
in `content/inlinePanel.js:1553-1555` — the button stays `display:none` until it is `true`, and a
live change hides it again (`:1562-1570`).

### From git log

- **2026-06-02, `024b9f6` "Stage 1: manifest + skeleton"** — booking was made *impossible* by
  construction: `FORBIDDEN_SELECTORS` listed `#rlb-book-btn` and
  `#rlb-book-trip-confirm-booking-btn`, and `ALLOWED_CLICK_INTENTS` had exactly three intents, none
  of them booking.
- **2026-07-20, `e40c26e` "Torren Relay: multi-domain support, Supabase OTP login with gating, 10%
  PAT markup, night mode navy-slate palette, verification rules in CLAUDE.md"** — the same commit
  **deleted all three booking selectors from `FORBIDDEN_SELECTORS`, leaving the array empty**, and
  **added `FAST_BOOK: 'FAST_BOOK'`** to `ALLOWED_CLICK_INTENTS`. ⚠ The commit message does not
  mention either change; the feature it makes possible is not named anywhere in the trail.
- **`FAST_BOOK_ENABLED = false` added** — the code says *"Added 2026-08-27, Ihor's decision"*
  (`utils/constants.js:129`); the commit that carries the line is `553317f` (2026-09-02, "build:
  include supabaseConfig in repository and release build").

So: Fast Book is **not** disabled by removal. It is one constant away from live, and the guard that
used to make booking structurally impossible was emptied two months before the flag was added.

---

## 2. The booking path, click to request

| # | Step | Where |
|---|---|---|
| 1 | Dispatcher clicks a load card (or the loop auto-opens the top new load) → Amazon's detail sheet opens; our inline panel is inserted under the card | `content/detailOpener.js:301` (`openTopNewLoad`), `content/inlinePanel.js:1577` |
| 2 | The action bar is built; the Fast Book button is created only if the build flag is true | `content/inlinePanel.js:862-871` |
| 3 | Its visibility is read from `chrome.storage.local.fastBookEnabled` | `content/inlinePanel.js:1553-1555` |
| 4 | Dispatcher clicks **Fast Book** → the only product call site | `content/inlinePanel.js:1557-1560` |
| 5 | `executeFastBook(sheetLoadId, btn)` — build-flag refusal, then the button is disabled and relabelled "Booking..." | `content/inlinePanel.js:384-415` |
| 6 | Amazon's sheet is resolved (`SHEET_SELECTOR`); absent → abort `no-sheet` | `content/inlinePanel.js:417-422` |
| 7 | Amazon's Book button is found: `#rlb-book-btn`, else the first `<button>` in the sheet whose text is exactly "Book"; absent → abort `no-book-button` | `content/inlinePanel.js:425-437` |
| 8 | `isForbiddenElement(bookBtn)` → abort `forbidden` **(inert: the list is empty — see §6)** | `content/inlinePanel.js:438-442` |
| 9 | **Identity gate**: the load id the button is bound to must equal the id of the load the board has selected; a missing marker gets its own louder abort | `content/inlinePanel.js:459-518` (`sheetOpenLoadId()` at `:1833`) |
| 10 | **Payout gate**: the record's payout must match an amount in the open sheet within `PAYOUT_TOLERANCE = 0.01` (`:31`); abstains when it cannot check | `content/inlinePanel.js:524-562` (`payoutGateFor()` at `:1769`) |
| 11 | Rehearsal stop — `dryRun` returns here, above both `.click()` calls | `content/inlinePanel.js:563-572` |
| 12 | **`bookBtn.click()`** — Amazon's own Book button | `content/inlinePanel.js:575` |
| 13 | A 100 ms poll, 5 000 ms ceiling, looks for `#rlb-book-trip-confirm-booking-btn` document-wide, falling back to a `<button>` inside the **sheet** whose text is "Book" / "Confirm" / "Confirm booking" | `content/inlinePanel.js:594-617` |
| 14 | `isForbiddenElement(confirmBtn)` **(inert)**, then **`confirmBtn.click()`** — this is the click that books | `content/inlinePanel.js:618-630` |
| 15 | Amazon's own page code issues the booking request. The extension sends nothing itself | see §3 |

---

## 3. What is sent to Amazon — **unknown, and not guessable from this repo**

- The extension never constructs a booking request. It clicks two of Amazon's own buttons
  (`content/inlinePanel.js:575`, `:627`); the HTTP call is made by Amazon's page code.
- **There is no capture of a booking request anywhere in `samples/`.** The only HAR is
  `samples/pat-copy-prefill.har` / `samples/pat-copy-prefill.trimmed.har`, and its request URLs are
  Post-a-Truck and search only: `/api/loadboard/filters`, `/api/loadboard/orders/get`,
  `/api/loadboard/orders/recommendations/`, `/api/loadboard/stats?…`, `/api/ons/v1/notifications`,
  `/loadboard/search`. No booking endpoint, no method, no payload.
- What **is** measured is the DOM, not the wire: `#rlb-book-btn` starts the flow and
  `#rlb-book-trip-confirm-booking-btn` finalises it — `AMAZON_DOM_REFERENCE.md:611-623`,
  `docs/AMAZON_SELECTORS.md:338-339`.
- **[?] Endpoint, method and payload fields are therefore unknown.** If they matter before
  re-enabling, they need one live capture of a booking made by hand in the Network tab — which this
  task did not do and which books a real load.

---

## 4. Safeguards that exist

1. **Build flag**, three redundant gates — §1.
2. **Storage toggle** `fastBookEnabled`, default false (`popup/popup.js:28`), hides the button and
   resets it live on change (`content/inlinePanel.js:1562-1570`).
3. **No confirmation dialog of our own.** The confirmation is Amazon's, and the extension *clicks it
   for him* (`:627`). The first press is the last decision point.
4. **Double-press protection**: the button is disabled and relabelled on entry
   (`content/inlinePanel.js:412-415`); every abort path either re-enables it (`:420`, `:436`,
   `:441`) or deliberately leaves it disabled carrying the reason (`:492-506`, `:545-555`).
5. **One poll at a time**: a live confirm poll is cancelled when a new Fast Book starts
   (`:587-592`), and on panel teardown (`:1616-1620`). ⚠ `showInlinePanel()` replaces a panel with
   `old.remove()` instead of calling `removeInlinePanel()`, so a poll **survives a plain panel
   replacement** — stated in the code itself at `:1610-1615` (BACKLOG 0al).
6. **Load re-check before booking** — the identity gate, `:459-518`: bound id vs the board's
   selected card, strict string equality, **fail closed** on either id missing. A missing
   selected-card marker blocks *every* press and says so (`:469-491`).
7. **Price re-check before booking** — the payout gate, `:524-562`: the stored record's payout must
   match an amount in Amazon's open sheet within one cent. ⚠ It **abstains** (booking continues,
   logged as a warning at `:556-558`) when there is no record, no payout on the record, or no amount
   found in the sheet — so a price change is only caught when both numbers are readable.
8. **Load gone / sheet closed** → `no-sheet` (`:417-422`) or `no-book-button` (`:433-437`), both
   before any click. **Price changed** → payout mismatch, button left disabled reading "Blocked —
   payout mismatch" (`:530-551`). **Wrong load open** → "Blocked — wrong load open" (`:488-517`).
9. **Timeout, not a guess**: if the confirm button never appears, the poll gives up at 5 s and the
   button is restored (`:631-636`). The fallback text sweep is scoped to the sheet, not the page
   (`:604-616`) — it used to sweep the whole document.
10. **Rehearsal path**: `__EXT_DEBUG.fastBookDryRun()` (`:2302`, `:2328`) runs every gate and stops
    above both clicks; `__EXT_DEBUG.fastBookForceMismatch()` (`:39-43`, `:402-410`) makes the next
    real press abort once.

---

## 5. Can a booking fire without a deliberate Fast Book click?

`executeFastBook` has exactly **two** call sites in the whole repo: the button's own click listener
(`content/inlinePanel.js:1559`) and the rehearsal helper, which passes `dryRun = true`
(`content/inlinePanel.js:2328`). With that in hand:

| Case | Answer | Evidence |
|---|---|---|
| Row / card click | **No** — the card click opens Amazon's sheet and inserts our panel; nothing calls `executeFastBook` | `content/detailOpener.js:206-232`, `content/inlinePanel.js:2193` |
| Auto-refresh | **No** — `refreshNow()` clicks only Amazon's Refresh button, guarded by a `tagName === 'BUTTON'` check as well | `content/refreshManager.js:88-118` |
| Alerts (sound, tab indicator, highlight) | **No** — the alert path calls `highlightNewLoads`, `playAlert`, `flashTabAlert`, `openTopNewLoad`; no booking call | `content/content.js:382-400` |
| Auto-open of the top new load | **No booking click** — it clicks the card at 30 % width / 50 % height ("neutral zone"), and the target must resolve inside the card | `content/detailOpener.js:184-232`, `:301` |
| Keyboard | **Yes, if the button is visible and focused** — it is a real `<button>` with a click listener, so Enter or Space on it fires the same handler. There is no key handler of our own anywhere in the panel (`grep keydown/keypress` in `content/inlinePanel.js`: none) | `content/inlinePanel.js:1557-1560` |
| Retry | **No new booking** — the only retry is the confirm poll inside one invocation; it clicks **confirm**, never Book, and stops on the first hit or at 5 s | `content/inlinePanel.js:594-637` |
| Restored state after the memory-watchdog reload | **No** — `running` is never persisted (`utils/tabState.js:5-6, 22-24`); the resume key restarts the loop, not a booking. A resumed loop can auto-open a panel, which is case 4 above | `utils/tabState.js:5-6` |
| A poll left over from a replaced panel | **Confirm-click only, and it can outlive its panel** — see safeguard 5; it cannot start a new booking, but it can complete one begun a moment earlier | `content/inlinePanel.js:1610-1615` |

---

## 6. `FORBIDDEN_SELECTORS` — what it protects, and what it protects **now**

**The list is empty** (`utils/constants.js:1-2`), so `isForbiddenElement()` returns `false` for every
element (`:4-7`). It is called before every Amazon-DOM click, at eight sites:

`content/refreshManager.js:65`, `:94` (Refresh) · `content/detailOpener.js:206`, `:327` (card click,
auto-open) · `content/panelCloser.js:119`, `:152` (sheet close, filter toggle) ·
`content/inlinePanel.js:438`, `:621` (**Book** and **Confirm**) · plus
`content/inlinePanel.js:2193`, which uses it to ignore clicks on forbidden elements.

What it was for: `docs/SAFETY.md:19` — *"`isForbiddenElement(el)` returns true if `el` or any
ancestor matches any of these selectors. Called before **every** `.click()`."* — and `:21`:

> **NEVER modify or remove these selectors.**

⚠ **The code block that should list them in `docs/SAFETY.md:15-17` is empty too**, so the canonical
safety document now documents an empty list directly above the instruction never to empty it.

**D30 is not in this repository.** `docs/DECISIONS.md` here numbers its records `EXT-D1`…`EXT-D5`
and contains no `D30` (`grep -rn "D30" docs/*.md` → no match); by its own header note, a bare `D…`
means the backend's `tenlane-network/docs/DECISIONS.md`, which this task's scope excludes from
reading. **Nothing is quoted for D30 rather than guessed** — say the word and I will read and quote
that one line.

---

## 7. Risks, worst first

1. **🔴 The booking guard is inert while two booking clicks are live code.** `FORBIDDEN_SELECTORS`
   is empty (`utils/constants.js:1-2`), so the `isForbiddenElement` checks at
   `content/inlinePanel.js:438` and `:621` — the two that sit in front of Amazon's Book and Confirm
   buttons — can never fire, and neither can the ones protecting the Refresh click, the card click
   and the panel closers. Re-enabling Fast Book with this empty means the Book/Confirm clicks have
   **no selector-level protection at all**, only the identity and payout gates. Restoring the three
   selectors from `024b9f6` is a one-line change and it is a precondition, not a nicety — note they
   must be restored **as the guard for other clicks**, while Fast Book's own two clicks are
   deliberately *exempt* (they target exactly those ids), so the exemption has to be explicit rather
   than achieved by leaving the list empty. **[?]** How that exemption should be expressed (an
   intent-scoped bypass vs a separate list) is a design decision, not something the code answers
   today.
2. **🔴 The extension clicks Amazon's confirmation for him.** `content/inlinePanel.js:627` presses
   `#rlb-book-trip-confirm-booking-btn`. There is no extension-side confirmation anywhere; one press
   of Fast Book spends money, and the only thing between the press and the booking is a 5-second
   poll. A misclick, or a stray Enter on a focused button (§5, keyboard), is irreversible.
3. **🟠 The payout gate can abstain and still let the booking through** (`:552-558`): no record, no
   payout on the record, or no amount readable in the sheet all continue to the click. So "the price
   is re-checked before booking" is true only when both numbers happen to be readable — the log says
   which, but the booking proceeds either way.
4. **🟠 A confirm poll can outlive its panel** when `showInlinePanel()` replaces a panel with
   `old.remove()` instead of `removeInlinePanel()` (`:1610-1615`). It can only click *confirm*, but
   it can do so after the panel it belonged to is gone.
5. **🟠 The Book-button fallback is text-based**: any `<button>` in the sheet whose text is exactly
   "Book" (`:427-432`), and the confirm fallback accepts "Book" / "Confirm" / "Confirm booking"
   inside the sheet (`:612-616`). An Amazon relabel or a second such button in the sheet is a
   wrong-click risk. **[?]** Unverified whether Amazon's sheet ever holds two.
6. **🟡 No capture of the booking request exists** (§3), so nothing about the request Amazon
   receives — endpoint, payload, idempotency — can be reviewed before turning this on.
7. **🟡 The store-listing promise and the manifest description depend on this flag**
   (`utils/constants.js:149-151`): flipping it to `true` must change the manifest description in the
   same commit, and `docs/STORE_LISTING.md` with it.
8. **🟡 The safety documentation is already out of step with the code** (`docs/SAFETY.md:15-21`),
   which is how the empty list survived for two months unnoticed.
