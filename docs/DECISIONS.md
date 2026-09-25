# Decisions — Tenlane Relay (the EXTENSION)

Product and architecture decisions for **this repository**, and the consequences each one leaves
behind.

> ⚠ **THIS IS NOT `tenlane-network/docs/DECISIONS.md`.** That file is the BACKEND's decision log and
> numbers its records `D1`…`D33`. This one numbers its records **`EXT-D1`…** so a reference can
> never be ambiguous about which repository it belongs to. A bare `D21` in either repo's code means
> the backend's file, which is where the numbered series already existed.

> ⚠ **Every session adds to this file, in the same commit as the change it describes.** A decision
> that exists only in a chat log is a decision the next person silently reverses.

---

## EXT-D9 — ✅ THE DISPATCHER'S NEGOTIATION PHRASES: A LIBRARY AND AN EDITOR. NOTHING TOUCHES AMAZON'S CHAT

**2026-09-24, Ihor.** Later, a button on our load card will open Amazon's own Relay Assistant chat
for that load, and a panel beside it will list the dispatcher's phrases — one click sends one into
the chat. **Booking always stays a manual click on Amazon's own Book button.** This step builds the
library, its editor and the renderer; it attaches to nothing.

🔴 **NOTHING HERE TOUCHES AMAZON'S PAGE, AND THAT IS THE POINT OF DOING IT NOW.** The chat DOM has
not been captured — `docs/AI_CHAT_CAPTURE.md` §7 records that a HAR holds no DOM, so the selector
for the control that opens the assistant is unknown `[?]`. Writing the panel against a guessed
selector is how you ship a feature that breaks on Amazon's next render. The parts that do not depend
on that selector are built and proved; the part that does is one named function away.

### The one entry point for the later integration

`phrases.phrasesForLoad(loadId)` → `[{ id, source, text, usable, reason, unknown }]` — every phrase
already rendered against that load's record. The future panel calls exactly this, draws the list, and
sends `text` on a click, so it will contain **no formatting, no arithmetic and no storage code of its
own**. ⚠ Nothing calls it yet, deliberately.

### Storage

- `chrome.storage.sync`, key **`phrasesV1`** — versioned in the name *and* in the value.
- 🔑 **SYNC FIRST, `local` AS FALLBACK.** Sync follows the dispatcher to a second computer, which is
  the whole point of a list he has tuned. Sync has hard quotas (~8 KB per item, 100 KB total, a write
  rate limit), so **every write checks `chrome.runtime.lastError`** — a quota failure arrives there,
  not as a throw, and without that check a full sync area loses writes silently. That is exactly how
  a phrase list "resets itself". On refusal the write goes to `local` and
  `phrases.whereStored()` says which is in use; the editor prints it.
- **Migration path, with only one version today.** An OLDER shape is upgraded field by field (v0's
  bare strings included); a **NEWER** one — a second machine already running a later build, syncing
  back — is kept EXACTLY as it is and reported, never rewritten by older code.
- **Export / import as JSON**, pretty-printed so it is hand-editable. Import also accepts a bare
  array of strings, because somebody will paste `["a","b"]` and refusing that helps nobody.

### The variables

`{payout}`, `{payout+N}`, `{payout+N%}` — and their minus forms, because a counter-offer below the
board rate is a real move. Results are **rounded to whole dollars** and formatted `$1,700`: the
record carries figures like `1699.5023456`, and "$1,699.50" in a negotiation reads as a machine
talking.

- **The payout comes from the record the extension already holds**, read the same way
  `payoutGateFor()` reads it (`content/inlinePanel.js`): a flat number, or the raw `{ value, unit }`.
  Never from the card's text — a price scraped from the DOM is a string in a currency and a locale,
  and this has to do arithmetic on it.
- 🔴 **NO PAYOUT MEANS THE PHRASE IS NOT USABLE.** `renderPhrase()` returns `usable: false` and the
  text **as typed** — never half-substituted, never "$0". A phrase that mentions the money with a
  hole where the number goes must not reach a live negotiation.
- ⚠ **An unknown variable does not block anything.** `{driver}` is left exactly as typed and listed
  in `unknown` so the editor can flag it — a dispatcher may be using braces as his own punctuation.

### The editor is in the POPUP

Chosen, not defaulted: the popup is where every stored preference is already edited, it opens without
touching Amazon's page, and it has room for a list that scrolls. The sidebar sits **on** the load
board where he is working a load — the phrases will be *used* there, beside Amazon's chat, but a list
you edit is not a list you read mid-negotiation.

List · add · edit · reorder (↑/↓) · delete · reset to the starter set (**confirmed**, the one
destructive control) · live preview against a payout he types · copy as JSON · import JSON.

**Limits: 20 phrases, 200 characters each**, enforced on save *and* on import so a hand-edited file
cannot get past them. Twenty is a list you scan while a load is on screen; two hundred characters is
two sentences, and a paragraph pasted into a chat buries the number being negotiated.

### The starter set — ⚠ WORDING FOR IHOR TO REVIEW

Plausible English negotiation lines, **not measured ones**: no capture of a real negotiation exists
in this repository.

```
Can you do better than {payout} on this one?
I can take it at {payout+150}.
My rate for this lane is {payout+10%} — can you meet that?
What is the detention policy at these stops?
Is there any flexibility on the pickup time?
Are there other loads on this lane at a better rate?
That works — I will take it at {payout}.
```

✅ **Proved.** The renderer, against the real `utils/phrases.js`: 20 cases — every variable form,
both payout shapes, fractional percent, thousands separators at 4 and 7 digits, two variables in one
phrase, an unknown variable, and the three "no number" cases (`payout: null`, no record at all, and a
payout that is a string) all correctly **not usable**. Export → import returns the same 7 texts; a
bare array imports; nonsense, an empty list, a 30-item file and a 400-character line are all handled
at the cap. Migration: nothing stored → starter set; v0 mixed shapes → upgraded; v99 → left untouched.

✅ **The editor, driven in headless Chrome against the real popup** (`popup.html` + `popup.js` +
`popup.css` + `phrases.js`, with `chrome.storage` shimmed onto `localStorage` so a reload is a real
reload): starter list of 7 → add → edit → move down → delete → **reload: identical, stored in sync**
→ preview renders `$1,500` → empty payout shows "Not usable" → export/import round trip → reset with
the confirm → reset **refused** at the confirm keeps his text → and with sync forced to refuse, the
write lands in `local` and the note says so. No page exceptions. `node scripts/build-zip.mjs` passes
(47 files).

---
## EXT-D8 — ✅ THE PROBE NOW SAYS WHICH PATH OPENED THE SHEET, AND READS IT AGAIN AT +1 s AND +3 s

**2026-09-24, Ihor — follow-up to EXT-D6.** The live result over **25 sheets: 18 `match`, 1 `differ`,
6 `sheet-unreadable` (24 %)**. His observation with it: **when auto-refresh finds a new load and
AUTO-OPENS it the price is not read; when he clicks the load himself it is.** EXT-D6's event could
neither confirm nor deny that — it recorded no trigger and read the sheet exactly once.

So two fields, and **still nothing decided**: `FAST_BOOK_ENABLED` is `false`
(`utils/constants.js:152`), `payoutGateFor()` is untouched, and no click of any kind was added.

### 1. The two paths, traced to the probe call

| | auto-open | manual click |
|---|---|---|
| what starts it | `openTopNewLoad()` → `attemptNeutralZoneClick()`, `content/detailOpener.js:331`, `:172` | the dispatcher's own click |
| before the click | `el.scrollIntoView()`, then **`setTimeout(…, 250)`** (`content/detailOpener.js:394`), then up to 10 frames waiting for a layout box (`:28`) | nothing |
| the click itself | **ONE constructed `MouseEvent('click')`**, `content/detailOpener.js:276-293` | the browser's own input sequence |
| what precedes it | **nothing** — "No pointerdown/mousedown/mouseup sequence was added" (`content/detailOpener.js:156`) | `pointerdown` → `mousedown` → `pointerup` → `mouseup`, **each in its own task**, separated by the dwell |
| our listener | `initManualToggle`'s one `document` click listener, `content/inlinePanel.js:2197` — **both paths, because the dispatched click bubbles to it** | the same listener |
| then | `showInlinePanel()` → `renderPanelFromData()` → the probe (`content/inlinePanel.js:1624`) | identical |

🔑 **THE DIFFERENCE IS NOT IN OUR CODE — IT IS IN WHAT PRECEDES THE `click` EVENT.** Both paths reach
the probe **synchronously inside the click dispatch**, so both read the sheet at T+0 ms from *the
click*. But a real click is the **last** of four input events and the browser delivers each in its
own task: by the time our listener runs, Amazon has had `pointerdown`, `mousedown` and the
dispatcher's dwell — **measured at +126 ms and +136 ms below** — to render. The auto-open dispatches
the `click` **alone**, so Amazon gets **zero**: measured at **+0 ms and +1 ms**. The 250 ms settle
does not help, because it is spent *before* the click, i.e. before Amazon has been told anything.

⚠ **WHAT AMAZON DOES WITH THOSE EARLIER EVENTS IS `[?]` AND IS NOT ASSERTED HERE.** Amazon is React
and its handlers cannot be enumerated from a content script — the same limit `content/inlinePanel.js`
already records for the click-zone rule. The proof below therefore drives **both** possibilities
rather than picking one, and only one of them can produce what Ihor saw.

### 2. What was added

- **`trig` on every event** — `'auto-open'` / `'manual-click'` / `'synthetic-other'` / `'other'`, plus
  `'unknown'` for every event recorded before today. Decided in the listener
  (`content/inlinePanel.js:2321-2328`) from **`ev.isTrusted`**, the browser's own bit: `true` only for
  a real input device, `false` for anything `dispatchEvent()` produced.
  🔑 **CORROBORATED, NOT INFERRED.** An untrusted click is only called `'auto-open'` when our own
  dispatch is on the stack — `isAutoOpenClickInFlight()` (`content/detailOpener.js:47`), set on the
  line before `dispatchEvent` and cleared in a `finally` on the line after. Any other synthetic click
  is `'synthetic-other'` and is **kept out of the auto-open figures**.
  ⚠ **THE TRIGGER IS NEVER DERIVED FROM HOW LONG THE READ TOOK.** That is the thing being measured;
  inferring the trigger from the timing and then explaining the timing by the trigger is circular.
- **`re1` and `re3`** — the **same** read again at **+1 s** and **+3 s** (`PRICE_PROBE_REREADS`,
  `utils/priceProbe.js`), each recording its **actual** elapsed ms rather than the nominal one,
  because a background tab throttles these timers exactly as it throttles the auto-open settle.
  ⚠ **SCHEDULED EVEN WHEN THE FIRST READ SUCCEEDED**, which is what makes "the read was too early"
  **falsifiable**: if an early read failed for some other reason, the later ones fail too.
- **The re-read is a CALLBACK the caller supplies** (`content/inlinePanel.js:1626-1631`), because
  `utils/priceProbe.js` touches no DOM — it also loads in the popup, which has no sheet to read.
- ⚠ **A RE-READ THAT WOULD READ ANOTHER LOAD'S SHEET IS `skipped`, NOT FILED.** Three seconds is long
  enough for the dispatcher to open a different load, so the closure re-checks that our panel still
  exists, that its card is still attached and that `cardLoadIdFor()` still returns the same id;
  otherwise it returns `null`. A wrong number filed as evidence is worse than a missing one.
- ⚠ **EVERY WRITE NOW GOES THROUGH ONE CHAIN** (`mutate()` in `utils/priceProbe.js`). One sheet is now
  **three** read-modify-write cycles over one key instead of one, and `chrome.storage` has no
  transaction — overlapping them loses whichever finished first.
- ⚠ **`pending` IS NOT `never`.** A tab closed inside the 3 seconds, and every pre-EXT-D8 event, has
  no re-read at all; counting those as "never became readable" would manufacture evidence against the
  hypothesis.

### 3. The popup

Three new lines split `sheet unreadable` **by trigger**, each printed as `n of m opened` — a bare
count of unreadable auto-opens says nothing without how many auto-opens there were — then
`readable at +1s`, `readable at +3s`, `still unreadable at +3s` and `no re-read`, each with the
auto/mine split in brackets. ⚠ `+1s` and `+3s` are **cumulative over the same pool, not a funnel**.

### 4. ✅ Proved in headless Chrome, and one model is ruled out

`utils/priceProbe.js` **whole and unmodified**, plus `payoutGateFor()` and `sheetPayoutAmounts()`
**sliced verbatim out of `content/inlinePanel.js` by the harness itself**. The manual click is a
**real trusted click** (CDP `Input.dispatchMouseEvent`: `mousePressed` → 120 ms dwell →
`mouseReleased`), so `isTrusted` is genuinely `true` and the input events are genuinely separate
tasks; the auto-open is the extension's own dispatch. The sheet appears with its route text at once
and its **price only later**, which is exactly what `sheetPayoutAmounts()` returns `[]` for.

| Amazon model | price lands | manual click | auto-open |
|---|---|---|---|
| **M** — sheet starts on `mousedown` | +800 ms | read at **+126 ms** → `sheet-unreadable` | read at **+0 ms** → `sheet-unreadable` |
| **M** — sheet starts on `mousedown` | +100 ms | read at **+136 ms** → **`match $588.62`** | read at **+0 ms** → `sheet-unreadable` |
| **C** — sheet starts on the `click` | +800 ms | read at **+0 ms** → `sheet-unreadable` | read at **+1 ms** → `sheet-unreadable` |
| **C** — sheet starts on the `click` | +100 ms | read at **+1 ms** → `sheet-unreadable` | read at **+0 ms** → `sheet-unreadable` |

**In all eight sheets the +1 s and +3 s re-reads returned `match`** — `match (1007ms)`,
`match (3005ms)` and so on — **so every `sheet-unreadable` above was unreadable YET, not unreadable.**
Trigger labelling was correct in all eight (`isTrusted true` → `manual-click`, `false` →
`auto-open`), every event carried both re-reads, so no patch was lost by the write chain, and
`logger.error` was never called.

🔑 **ONLY ONE ROW REPRODUCES WHAT IHOR SAW**, the second: **model M with the price landing inside the
dwell**. It is the only combination in which the manual path matches while the auto-open path cannot.
Two consequences follow, and neither needed a guess about Amazon:
- **Model C is ruled out as the explanation.** If Amazon began rendering only on the `click` event,
  both paths would read at the same offset and his manual clicks would fail as often as the
  auto-opens. They do not — 18 of 25 matched.
- **The gap that matters is small.** At +800 ms even a real click fails, so for 18 of 25 manual reads
  to have matched, Amazon's price must normally land **within roughly the dwell** — and the auto-open
  misses it by dispatching a lone `click`. `[?]` Whether the earlier events are `pointerdown` or
  `mousedown`, and whether the price comes from state already held or from a fetch, is still unproven,
  and is exactly what the live `re1`/`re3` numbers will now settle.

⚠ **THE OBVIOUS FIX IS DELIBERATELY NOT TAKEN YET.** Reading at the click and again a second later,
and trusting the later value, would change what the gate sees — and the real Fast Book gate reads at
the **moment of the Book button click**, later still than any of these probes. Which read the gate
should trust is a decision for the live numbers, not for this step. Nothing here alters a gate.

`node scripts/build-zip.mjs` → all assertions passed, 46 files, `dist/tenlane-relay-1.1.0.zip`.

---

## EXT-D7 — ✅ 1.1.0, AND THE NAME IS FULLY "Tenlane Relay". THREE EXTERNAL IDENTIFIERS STAY AS THEY ARE

**2026-09-24, Ihor.** Ship the rename as **1.1.0**. The product name was already changed on
2026-09-07 (`docs/RENAME.md`, branch `rename/tenlane`); this record is the verification that nothing
user-visible was left behind, plus the version bump and the standing list of what must not move.

### The version

`manifest.json:4` — `"version": "1.1.0"` (was `1.0.0`). **It is declared in exactly one place.**
`EXT_VERSION` derives from the manifest (`utils/constants.js:32-34`), the popup prints it from the
manifest (`popup/popup.js:169-171`, EXT-D1) and `scripts/build-zip.mjs` names the archive from it —
`dist/tenlane-relay-1.1.0.zip`. The two `1.0.0` strings still in comments
(`popup/popup.js:104`, `utils/constants.js:27`) are the *history of the drift EXT-D1 fixed* and are
left as written: a historical note edited to match today's number stops being a record.

1.1.0 carries, since 1.0.0: the tab indicator (EXT-D4, EXT-D5), the passive price-read measurement
(EXT-D6) and the Fast Book audit (`docs/FASTBOOK_AUDIT.md`). ⚠ **`FAST_BOOK_ENABLED` is still
`false`**, so the manifest description — "does not book loads" in the listing — remains true of this
build (`utils/constants.js:128-151`).

### The name — verified, not assumed

**Zero occurrences of "Torren" remain in shipped code**: `*.js`, `*.json`, `*.html`, `*.css` across
`utils/`, `content/`, `popup/`, `scripts/`, `background.js`, `manifest.json`. Every user-visible
surface reads **Tenlane Relay**: `manifest.json:3` (`name`) and `:117` (`action.default_title`),
`utils/constants.js:25` (`EXT_NAME`, the sidebar title via `content/sidebar.js:219`) and `:270`
(the page-gate warning), `content/cityAssign.js:1273`, `:1391`, `:2205`, `:3573`,
`content/sidebar.js:444`, `popup/popup.html:6`, `:13`, `:28`.

⚠ **There is no `short_name` key** — Chrome falls back to `name`, so nothing shortened can drift.
One was not added: an absent key cannot disagree with the one beside it.

⚠ **The icons carry no wordmark.** `icons/icon128.png` is a blue rounded square with a white "T"
and a dot — read and looked at, not assumed. The glyph fits both names, so no icon file was touched.

### What was deliberately NOT renamed, and why

🔑 **NOTHING PERSISTED OR WIRE-FORMAT EVER CARRIED THE BRAND.** Storage keys, runtime/`postMessage`
types, `data-testid` values, CSS class and id names and Supabase table/column/RPC names were all
searched for `torren` in 2026-09-07 and again now: **zero matches**. So there is no migration to
write and no saved setting to orphan — and equally, there is nothing left to rename. Had any of them
carried it, the rule stands: **a stored key is a contract with the installed base, not a label.**

The 45 remaining mentions of "torren" are all in Markdown, and each is one of three **external
identifiers that exist at that spelling**, or a record of one:

| identifier | where | why it stays |
|---|---|---|
| `https://iter-tech.github.io/torren-relay/` | `docs/STORE_LISTING.md:162`, `:172`, `:272`, `STATE.md:30`, `docs/PLAN.md:172`, `docs/RELEASE_AUDIT.md:426`, `docs/REVIEW_RESPONSE.md:190`, `docs/CHANGELOG.md:46`, `:68` | **live, published, and cited in the store submission.** The path is the GitHub repo name; editing the string would cite a page that does not exist |
| `github.com/…/torren-relay` | `docs/STORE_LISTING.md:165`, `docs/CHANGELOG.md:71`, `:277`, `:279` | the repo hosting that page, plus a dated record of the 2026-09-02 Pages 404 diagnosis |
| `torrenrelayreview@proton.me` | `docs/STORE_LISTING.md:231`, `:273`, `STATE.md:33`, `docs/PLAN.md:134`, `:172`, `docs/RELEASE_AUDIT.md:429`, `docs/REVIEW_RESPONSE.md:161`, `docs/CHANGELOG.md:50` | **the mailbox exists at this address** and is handed to the Chrome Web Store reviewer for their one-time code |

Plus two records *about* the old name, correct as written: `docs/RENAME.md` (the rename itself) and
`docs/FASTBOOK_AUDIT.md:39`, which quotes commit `e40c26e`'s message verbatim.

### The production domain — still none, and nothing was invented

There is **no production domain for the Tenlane site**, so no URL was changed. The places that will
need one, when it exists:

1. `manifest.json:105-110` — the `siteBridge.js` content script matches **`http://localhost:3000/*`,
   `http://127.0.0.1:3000/*`**. This is the only place the site's origin is pinned; `siteBridge.js`
   itself is origin-agnostic (it compares against `window.location.origin`, `:48`, and replies to
   it, `:40`), so adding the production origin here is the whole change.
2. `manifest.json` — **no `externally_connectable` key exists.** If the site ever calls the
   extension directly instead of through `postMessage`, that key must list the domain.
3. `utils/supabaseConfig.js:4` — `https://beoiwdadatcnobowfsvv.supabase.co`, the backend. Unrelated
   to the product name; it changes only if the Supabase project does. `manifest.json:27` grants
   `https://*.supabase.co/*` for it.
4. The privacy-policy URL and the reviewer mailbox above — both move only when the real ones do, and
   both must be verified live **before** the docs are edited, not after.

⚠ **STILL OPEN from the 2026-09-07 rename:** the *deployed* policy page at the live URL said "Torren
Relay" when it was last checked, while `docs/index.html` and `docs/PRIVACY_POLICY.md` in this repo
say "Tenlane Relay". **Deploy the page before submitting 1.1.0**, or a reviewer comparing the
listing with the policy sees two different products.

---
## EXT-D6 — ✅ MEASURE THE PRICE READ BEFORE FAST BOOK RELIES ON IT. PASSIVE, AND IT DECIDES NOTHING

**2026-09-24, Ihor.** Fast Book will be **one click**, and it **must not book when the price cannot
be read**. Today the payout gate does the opposite — it **abstains** and lets the booking through
whenever it cannot read one of the two numbers (`content/inlinePanel.js:524-562`, and
`docs/FASTBOOK_AUDIT.md` §4.7). Before that rule is inverted, how often each outcome actually
happens on a real board has to be known, because inverting it blindly would turn every unreadable
read into a refused booking — possibly most of them.

**So: measure first, decide after.** `FAST_BOOK_ENABLED` stays `false`, and the gate's behaviour is
unchanged in this step.

### What runs, and where

Every time Amazon's sheet opens and our panel binds to it — the manual card click and the auto-open
both converge on `showInlinePanel()` — the panel's last act is to run **the gate's own read** once
and file the verdict: `content/inlinePanel.js` at the end of `showInlinePanel()` calls
`priceProbe.record(sheetLoadId, payoutGateFor(sheetLoadId, document.querySelector(SHEET_SELECTOR)))`.

🔑 **IT CALLS `payoutGateFor()` ITSELF, NOT A COPY OF IT.** A measurement that re-derived the two
numbers would be measuring itself and would drift the moment the gate changed. `payoutGateFor` only
reads — `getLoadRecord()` and the sheet's `textContent` — so calling it costs nothing and clicks
nothing; its return value is filed and dropped.

⚠ **NOTHING IS DECIDED FROM IT.** Removing the probe would change no booking outcome. That property
is what makes it safe to ship while the booking path is still off.

### The four results, in his words

| result | means |
|---|---|
| `match` | both numbers read, agree within one cent (`PAYOUT_TOLERANCE`, `content/inlinePanel.js:31`) |
| `differ` | both read, and they disagree — the case that must block a booking |
| `record-unreadable` | no captured record for this load, or the record carries no payout |
| `sheet-unreadable` | nothing money-shaped could be parsed out of Amazon's open sheet, or the read threw |

⚠ **A THROWN READ IS FILED AS UNREADABLE, NOT DROPPED.** An exception is exactly what a "must not
book when the price cannot be read" rule has to cover, so it has to appear in the numbers.

⚠ **THE DIFFERENCE IS MEASURED AGAINST THE NEAREST SHEET AMOUNT, SIGNED, sheet − record.** The sheet
prints several amounts (the payout and rate-per-mile figures) and the gate only asks whether the
record's payout is *among* them; filing the first amount in DOM order would report a $2.31 per-mile
figure as a "$665 difference" and make every mismatch look identical. Positive means Amazon is
showing **more** than we recorded — "up" and "down" are different risks and are counted separately.

### Where it is kept

`chrome.storage.local`, key **`priceProbeEvents`**, a ring buffer capped at **500** events
(`utils/priceProbe.js`): ~55 KB at worst, against a 5 MB quota, and a cap is what keeps a board left
open all week from growing it without bound. One event is
`{ t, id (first 8 chars), rec, sheet, n, result, reason, diff }`.

⚠ **THE KEY IS DELIBERATELY OUTSIDE `STORAGE_KEYS`**, exactly as `loadSenderStats` is
(`utils/storage.js:58`): "Reset to defaults" clears *settings*, and a measurement is not a setting.
Wiping weeks of evidence as a side effect of resetting a toggle is not a trade worth making. The
popup carries its own **Clear measurement** button for when he wants it gone.

⚠ **DEDUPED WITHIN 1500 ms PER LOAD.** One sheet opening can render our panel more than once (a
re-render replaces it); counting that twice would inflate every percentage.

### How he reads it — one click, no console

The popup shows a **Price check (measurement)** block, filled the moment it opens, with totals and
percentages per result and the differences bucketed `$0 / up to $5 / $5–15 / $15–50 / over $50`,
each split higher/lower. **Copy raw events** puts `{exportedAt, version, summary, events}` on the
clipboard as JSON (the `clipboardWrite` permission the card screenshot already uses). So: open the
popup (1 click) → read; copy (2nd click). The summariser and the buckets live in
`utils/priceProbe.js`, the same file the content script writes through, so the popup cannot disagree
with what was recorded.

### The +10% display rule is not involved — verified

`PAT_PAYOUT_MARKUP_RATE = 1.10` exists in exactly one place, `content/patModal.js:18`, applied at
`:1080` to the **Payout field of our own Post-a-Truck modal** and nowhere else (`grep "1\.1\b"`
across `content/` and `utils/` finds no other multiplier). The gate compares **Amazon's raw number
with Amazon's raw number**: the record side is `item.payout.value` straight from Amazon's own API
response (`content/networkObserver.js:441`), and the sheet side is parsed from Amazon's own sheet
text (`content/inlinePanel.js:1741-1757`). Neither is ever multiplied, and nothing writes a marked-up
figure back into Amazon's DOM. Had it compared the display value, every booking would have been
blocked as a 10 % mismatch — which is why this was checked before anything else.

✅ **Proved in headless Chrome** against the real `payoutGateFor` / `sheetPayoutAmounts` (lifted
verbatim from `content/inlinePanel.js`) and the real recorder, seven sheets: normal price → `match`;
`$2,320.23` with a comma beside a `$2.31/mi` figure → `match` (the nearest-amount rule picks the
payout, not the per-mile); +$31.83 → `differ +31.83`; −$18.17 → `differ −18.17`; no `$` in the sheet
→ `sheet-unreadable (no-amount-in-sheet)`; record with a null payout → `record-unreadable
(record-has-no-payout)`; no record at all → `record-unreadable (no-record)`. No click was sent in any
case.

---
## EXT-D5 — ✅ THE TAB INDICATOR IS ALWAYS ON. NO SETTING GATES IT, AND "Tab Alert" IS GONE

**2026-09-24, Ihor.** He tested EXT-D4 on a live board and **nothing changed**: Amazon's favicon
stayed, no magnifier while the loop ran, no alert on a new load. The indicator was correct; it was
never allowed to start.

### 🔴 THE CAUSE — a default-OFF switch in front of everything

EXT-D4 put the whole indicator behind the old "Tab Alert" checkbox, which is `false` unless the
dispatcher had ever switched it on:

```
content/tabAlert.js:38    var tabAlertEnabled = false;
content/tabAlert.js:128   applyTabAlertSetting(await storage.get(STORAGE_KEYS.TAB_ALERT, false));
content/tabAlert.js:107   tabState.subscribe('running', function (val) { if (!tabAlertEnabled) return; … });
content/tabAlert.js:80    async function flashTabAlert(count) { if (!tabAlertEnabled) return; … }
```

With default storage `applyTabAlertSetting(false)` also returned on its first line (the value was
already `false`), so not one state was ever rendered and not one `tab-state` line was written.
**Nothing else was blocking it** — the module has no page gate, no auth gate and no focus gate on
the searching state, and `content.js:390` calls `flashTabAlert` whenever `newCount > 0`.

### The decision

**The indicator is always on.** Ihor asked for the site's behaviour and the site has no such
switch, so the switch is gone rather than defaulted differently — a hidden toggle that silently
disables a state machine is exactly how this was lost for a day.

**Removed with it:**
- `popup/popup.html` — the "Tab Alert" row (label + checkbox + track).
- `popup/popup.js` — `KEY_TAB_ALERT`, the `tabToggle` lookup, its entry in the settings read, its
  `change` listener and storage write, its Reset line and its `storage.onChanged` line. Zero
  references left in either popup file.
- `content/tabAlert.js` — `tabAlertEnabled`, `applyTabAlertSetting()` and the four early returns.
- `utils/storage.js` — ⚠ the **key stays listed**, marked legacy, exactly as `SPEED` and `RUNNING`
  are: nothing reads or writes it, and keeping it listed is what lets "Reset to Defaults" clear the
  value already sitting in existing installs.

### 🔑 AND ONE LINE THAT PROVES THE CODE IS LOADED

At content-script start: `tab-indicator ready`, with the version **read from the manifest** (EXT-D1),
through `logger.notice` — a new level added to `utils/logger.js` at **1**, the shipped
`DEBUG_LEVEL`, printed with `console.info`. `logger.log` needs 3 and `logger.warn` needs 2, which is
precisely how `radiusUnitCaveat()`'s warning ended up invisible in a shipped build and why
`warnIfUnrecognisedRelayPage()` reaches past the logger to `console.warn`. ⚠ `notice` is reserved
for readiness lines — a handful per page load; anything recurring belongs at `log`.

⚠ **THE `tab-state` DIAGNOSTICS STAY AT `log`** (`DEBUG_LEVEL ≥ 3`). They are for an investigation,
not for a shipped console, and the readiness line is what a live check needs.

Everything else from EXT-D4 is unchanged: the site's drawing and state machine, one owned icon link,
Amazon's links parked while a state shows, idle as an explicit `href` write of Amazon's own favicon,
release on unload and on deactivate, and the alert clearing on start / after 60 s / on return to the
tab.

✅ **Proved in headless Chrome with DEFAULT storage — nothing pre-set**, the condition EXT-D4 failed
under: paused (Amazon's favicon) → search ON (magnifier) → new load (red disc, `(3) Relay | Load
Board`) → alert cleared → pause. One live icon link, ours, in every state; one `href` write per idle
transition; the readiness line present.

---
## EXT-D4 — ✅ THE RELAY TAB SHOWS THE BOARD'S OWN INDICATOR, WITH AMAZON'S FAVICON AS THE IDLE STATE

**2026-09-24, Ihor.** The Amazon Relay tab now says what the Tenlane Network board's tab says, in
the same drawing and by the same rules — with **one deliberate difference: idle is Amazon's own
favicon**, not our logo. It is Amazon's tab; when we are doing nothing it must look untouched.

```
paused / idle   Amazon's own favicon, written back explicitly
searching       our magnifier with a sweep round its ring, while the loop runs (12 frames, 250 ms)
new load        our red disc with an exclamation, blinking (2 frames, 550 ms) + "(3) " on the title
```

U1's soft breathing dot (one hue, two alphas, 900 ms, title alternation) is **replaced**. Its real
lesson is not:

### 🔴 IDLE IS AN href WRITE, NEVER JUST REMOVING OUR LINK

Both repositories learned this separately — here in U1 (2026-08-20), and on the site again on
2026-09-24, where it was finally measured: **the idle path performed zero `href` writes**, while the
sweep and the blink move precisely because they write `href` four times a second. A browser does not
re-read the remaining icon links because one was detached, so "stopping" left our mark on the tab —
it stopped animating but never disappeared. Every state here, idle included, is an `href` write on
**one** link that we own.

### 🔴 AND RELAY CAN PUT ITS OWN ICON LINKS BACK

Relay is a single-page app, so its framework may re-insert its `<link rel="icon">` elements at any
time — and one appearing **after** ours sits later in document order and wins. So: ours is the only
LIVE icon link while a state is showing, every other one is **parked** (its `rel` renamed to
`ext-parked-icon`, which takes it out of the running), and a `MutationObserver` on `<head>` parks
any that appear between two writes. The parked list holds only elements still in the document and
never stores one twice — the site's version pushed on every write and climbed 1, 6, 9… over a
session. `release()` writes Amazon's href, unparks, removes ours and restores the title, in that
order, so the tab is already right before the link the browser follows disappears.

⚠ **AMAZON'S href IS MEASURED AT RUNTIME, NOT ASSUMED**: the last icon link in document order — the
one the browser was following — captured before anything is parked. If Relay declares no icon link
at all, the fallback is `location.origin + '/favicon.ico'`, which is what the browser would have
used anyway. **The exact shape of Relay's `<head>` is still unmeasured** (no capture in this repo,
and the live page was not opened): the design does not depend on it, and it was proved against three
heads — one classic `shortcut icon`, three icon links re-inserted every 1.5 s, and none at all.

### The transitions are the site's, read from its code

- The **alert wins** over searching while it is up.
- **Starting the loop clears the alert** — resuming is the acknowledgement (the site's ring toggle).
- An alert **clears itself after 60 s**, the site's `NEW_HIGHLIGHT_MS` window; a newer batch
  replaces the old one and restarts the clock.
- **Leaving the page** clears everything and hands Amazon its icon and title back.
- The title carries **the count and no glyph** — the favicon already says which state it is.

⚠ **ONE EXTRA TRANSITION IS OURS, AND IS KEPT ON PURPOSE:** returning to this tab clears the alert
(U1). The site has no such rule because nobody is "away" from a page they are looking at; here the
mark exists for a tab in the background, so seeing it is acknowledging it. **This and the idle icon
are the only two differences from the site.**

⚠ **THE "Tab Alert" SETTING NOW GATES THE WHOLE INDICATOR**, not only the new-load state — it is the
dispatcher's answer to "may we mark this tab", and it is **OFF by default**, so an untouched Relay
tab stays the default. With it off we never write an icon link or a title at all; switching it off
mid-session releases immediately.

⚠ **THE COLOURS ARE THE SITE'S LITERALS (`#2563eb`, `#dc2626`), DELIBERATELY NOT `--ext-*` TOKENS.**
The indicator's job is to look like the board's tab, not like this extension's UI; reading our own
accent token would make the two tabs disagree the moment either palette is retuned. U1's dot did
read the token — that indicator is gone.

🔑 **IT IS A COPY OF THE SITE'S MODULE, ON PURPOSE.** `utils/tabIndicator.js` carries the same
drawing, frame counts, intervals and state machine as `tenlane-network/web/src/lib/tabState.ts`
(which is read-only from here). **If you change one, change both** — two tabs that disagree about
what "searching" looks like would be worse than either choice.

🔑 **LOGGED THROUGH THE EXISTING SWITCH.** No new debug flag: `logger.log('tabIndicator', …)` at
`DEBUG_LEVEL ≥ 3` (`utils/constants.js`), with the site's own entries — `tab-state`
(`state, favicon, animated, frames, frameMs, count, liveIconLinks, ours, effectiveHref,
parkedLinks, glyph`) on every change, and `tab-title-set` (`wrote, baseTitle, readBack`) on every
write.

⚠ **A TITLE BASE IS ADOPTED ONLY WHEN THE TITLE IS NOT OURS.** Relay retitles itself on navigation,
so a base captured once goes stale — but re-reading it while our count is up swallows the count into
the base for ever. Measured in the harness before it was fixed: the title stayed
`(3) Relay | Load Board` for the rest of the session.

✅ **Proved in headless Chrome against all three heads**, driving the real `utils/tabIndicator.js`
and `content/tabAlert.js`: paused → search ON → new load (3) → alert cleared → pause → search ON →
pause → unload. **Exactly one live icon link, and ours, in every state**; idle is one `href` write
to Amazon's own; the parked count stays flat (3 in the re-inserting case) instead of growing; unload
leaves Amazon's links live and ours gone.

---
## EXT-D3 — ✅ MEASURED ON A LIVE BOARD: the sender loses nothing. And page 2 is not a target.

**2026-09-20.** EXT-D2 added a counter to every path by which a record could vanish. The
measurement has now been run on a real Amazon board, and it answers the question
`tenlane-network/docs/LOSS_ANALYSIS.md` could not.

### ✅ THE RESULT — one session, every drop counter ZERO

```
seen                3047
sent                 953

dropped.noId               0
dropped.evicted            0
dropped.discardedTeardown  0
dropped.acceptThrew        0
dropped.discardedDisabled  0
dropped.notArrayEvents     0
failures                   0
```

🔑 **NO LOAD IS BEING LOST BY THE SENDER.** Every mechanism `LOSS_ANALYSIS.md` identified as *able*
to drop a load silently — the 500-entry buffer eviction above all — fired **zero times**.

⚠ **THE GAP BETWEEN 3047 AND 953 IS DEDUPLICATION, NOT LOSS.** `seen` counts **every record the
sender is handed**, and the board re-sends the same loads on every tick: `accept()` keys the buffer
by `amazon_wo_id`, so the second and subsequent sightings of a load replace the first entry instead
of adding one. A load seen on twenty ticks is twenty `seen` and one row. That is the design, and
the database agrees with it — 1006 distinct `amazon_wo_id` against 4496 total sightings, 0
duplicates.

🔴 **THIS CLOSES THE "MANY LOADS NEVER REACH THE WEBSITE" REPORT AS FAR AS THE SENDER GOES.**
Whatever else explains a load the dispatcher saw and the site does not show, **it is not the sender
dropping it**, and the buffer limit does not need changing.

### ⚠ IHOR'S DECISION: pages 2+ of Amazon's results are NOT a target

The extension captures what the board returns for the **first** page of results. Later pages are
not fetched, and **that is acceptable, by decision, not by oversight.**

🔑 **THE PRODUCT IS FOR FINDING GOOD LOADS, AND THE GOOD ONES ARE ON THE FIRST PAGE.** Amazon
already orders results by what it considers the best match. Paging deeper would multiply the
request volume against Amazon's endpoints and fill the network's table with freight nobody was
going to take.

⚠ **SO "THE SITE DOES NOT HAVE EVERY LOAD ON AMAZON" IS NOT A DEFECT, AND MUST NOT BE FILED AS
ONE.** A future session finding the gap should read this record before "fixing" it. If the decision
is ever revisited, the thing to weigh is request volume against Amazon, not whether the counters
would notice — they would: deeper pages would raise `seen`, and `evicted` would be the first thing
to move if the buffer could not keep up.

### What the counters are for now

They stay. Their value is no longer diagnosis but **regression detection**: the balance
`seen === accepted + dropped.*` and a non-zero `evicted` are now the two things that would announce
a real loss, in the popup, without anyone having to reason about it. See EXT-D2 for the arithmetic.

---
## EXT-D2 — ✅ EVERY WAY A LOAD CAN VANISH IS COUNTED. Nothing is fixed yet.

**2026-09-20.** `tenlane-network/docs/LOSS_ANALYSIS.md` concluded that load loss **cannot currently
be measured**: `_stats.seen` lived only in runtime memory, records with no `id` were skipped before
the counter ran, and the 500-entry buffer eviction had no counter at all. This makes the loss
observable. **It changes no behaviour.**

### 🔑 `seen` MOVED TO THE FRONT, AND THAT IS THE POINT

It used to be incremented **after** `toRow()` returned a row:

```js
var row = toRow(records[i], endpoint);
if (!row) continue;
_stats.seen++;          // <- a record dropped for a missing id was counted NOWHERE
```

It is now the first thing that happens to every record, before any filter, and a second counter
`accepted` records what used to be `seen`:

```js
_stats.seen++;
var row = toRow(records[i], endpoint);
if (!row) continue;
_stats.accepted++;
```

⚠ **THIS CHANGES WHAT `seen` MEANS.** Anything reading `loadSenderReport().stats.seen` and
comparing it against past numbers is comparing two different quantities.

### The seven drop reasons — five asked for, two found while doing it

| counter | where | behaviour changed? |
|---|---|---|
| `noId` | `toRow()` — `if (!rec || !rec.id)` | **no** — counted only |
| `threw` | `toRow()` catch | **no** |
| `evicted` | `accept()` — buffer over `LOAD_SENDER_MAX_BUFFER` | **no**, and 🔴 **the 500 limit is unchanged** |
| `discardedDisabled` | `flush()` — the toggle went off, buffer cleared | **no** |
| `notArrayEvents` | `accept()` handed a non-array | **no** |
| `discardedTeardown` | `stop()` — deactivation clears the buffer | **no** — ⚠ **FOUND WHILE INSTRUMENTING** |
| `acceptThrew` | `accept()` catch — the rest of the batch never ran | **no** — ⚠ **FOUND WHILE INSTRUMENTING** |

⚠ **`notArrayEvents` COUNTS EVENTS, NOT LOADS, AND SAYS SO.** There is no array to measure when
`accept()` is handed a non-array, so a record count there would be invented. It is named for what
it is, so the arithmetic below is never quietly wrong.

🔑 **`acceptThrew` IS COUNTABLE ONLY BECAUSE THE LOOP INDEX IS PUBLISHED.** `_acceptIndex` is set
each iteration, so `records.length - _acceptIndex` is the number that never ran. Without it the
remainder of a throwing batch would be exactly the invisible loss this record exists to end.

### The arithmetic that must hold

```
seen     === accepted + dropped.noId + dropped.threw + dropped.acceptThrew
accepted === sent + buffered + dropped.evicted + dropped.discardedDisabled
                             + dropped.discardedTeardown
```

**If those do not balance on a live board, a path is still uncounted.** That is the test.

### Persisted through the storage the extension already uses

`chrome.storage.local`, the same mechanism as the toggle and the session. **No new storage layer.**

⚠ **THE KEY IS DELIBERATELY OUTSIDE `STORAGE_KEYS`.** `utils/storage.js` documents that "Reset to
Defaults" clears `Object.values(STORAGE_KEYS)`; `SUPABASE_SESSION_KEY` sits outside it for exactly
that reason, so resetting preferences does not log the dispatcher out. **Wiping a loss measurement
as a side effect of resetting display preferences would be the same class of mistake**, so
`LOAD_SENDER_STATS_KEY` sits outside it too and the Load Network block carries its own Reset.

⚠ **WRITES ARE DEBOUNCED 2 s.** `accept()` runs per record; a write per record would be hundreds a
minute. The flush path saves explicitly as well, so no number is more than one flush interval stale.

⚠ **`buffered` IS NOT RESTORED ON LOAD.** It describes this tab's live Map, not history. Everything
else is cumulative across reloads — a counter that restarts at zero on every SPA navigation cannot
measure a shift.

### In the popup

A plain-text block under **Load Network**: seen, sent, buffered, then each drop reason, then send
failures, then **Reset counters**.

⚠ **EVERY DROP REASON RENDERS EVEN AT ZERO.** A row that appears only once it fires is a row nobody
thinks to look for — which is how this went unnoticed in the first place.

⚠ **AN EM DASH MEANS "NEVER RECORDED"; `0` MEANS "RECORDED AS ZERO".** Different facts, shown
differently.

### 🔴 NOTHING IS FIXED

The 500-entry limit, the `no id` skip, the discard-on-disable and the discard-on-teardown all
behave exactly as before. **This record adds measurement and nothing else.** What to do about any
of them is a separate decision, and it should be taken against real numbers from a live board
rather than against the reasoning in `LOSS_ANALYSIS.md`.

---
## EXT-D1 — ✅ THE POPUP READS THE VERSION FROM THE MANIFEST. It is never declared twice.

**2026-09-20.** The popup displayed **v0.1.0** while the extension shipped as **1.0.0**.

### What was measured, before anything was changed

Three places declared a version. Only one of them is authoritative:

| file:line | literal | what it is |
|---|---|---|
| `manifest.json:4` | `"version": "1.0.0"` | ✅ **the source of truth** |
| `popup/popup.html:14` | `<span class="popup-version" …>v0.1.0</span>` | 🔴 hardcoded, stale, **and what the popup actually rendered** |
| `utils/constants.js:26` | `const EXT_VERSION = '0.1.0';` | 🔴 a second hardcoded copy, also stale |

🔑 **THE POPUP RENDERED THE HTML LITERAL — established by tracing, not assumed.** `popup/popup.js`
contains no reference to `popup-version` and no reference to the version at all; its only two
matches for the word are prose in comments at lines 266 and 298. Nothing overwrites the span, so
the text in `popup.html` is what reached the screen.

⚠ **`EXT_VERSION` WAS NOT THE POPUP'S SOURCE, THOUGH IT IS LOADED THERE.** `popup.html:244` does
load `utils/constants.js`, but nothing in the popup reads the constant. Its sole reader is
`content/content.js:1`, a log line. It was a *third* number, wrong in a second place, for a
different audience.

### The decision

**The version is read from `chrome.runtime.getManifest()` at runtime, in both places.** No file
other than `manifest.json` declares one.

```js
// popup/popup.js, inside DOMContentLoaded
var versionEl = document.getElementById('popup-version');
if (versionEl && chrome.runtime && chrome.runtime.getManifest) {
  versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
}
```

```js
// utils/constants.js
const EXT_VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest)
  ? chrome.runtime.getManifest().version
  : null;
```

🔑 **HARDCODING WAS POSSIBLE AND WAS REJECTED.** Writing `1.0.0` into the HTML would have been
correct for exactly as long as it took someone to bump the manifest — which is precisely how the
`0.1.0` got there. `chrome.runtime.getManifest()` is available on every extension page **and** in
content scripts, and `utils/constants.js` loads in no other kind of context (content scripts via
`manifest.json:51`, and `popup.html:244` — nothing in Node reads it). So there was no reason to
keep a copy.

⚠ **NO FALLBACK STRING, DELIBERATELY.** If the call is somehow unavailable the popup's span stays
**empty** and `EXT_VERSION` is **null**. An empty slot is visibly missing; a stale number looks
right and is not. A fallback literal would also be the very second copy this record exists to
remove.

⚠ **THE VERSION NUMBER ITSELF WAS NOT CHANGED.** `manifest.json` said `1.0.0` before this work and
says `1.0.0` after. This record is about where the number is read from, not what it is.

### Consequences

- `popup/popup.html:14` now carries **no text** — it is filled at `DOMContentLoaded`. A test that
  asserts on `[data-testid="popup-version"]` must wait for that, not read the static HTML.
- The span gained `id="popup-version"` so `getElementById` can find it, matching how every other
  popup control is wired.
- `EXT_VERSION` is now `string | null` rather than always a string. Its sole reader logs it.
- `docs/VERSION_BUMP.md`'s "Where the version lives" table lists `manifest.json` as the only
  authoritative declaration and does **not** mention `popup.html` or `constants.js`. That table was
  describing the intended design; these two files were violating it. It is now true as written.
