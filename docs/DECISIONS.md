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
