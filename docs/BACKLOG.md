# Feature Backlog

Status key: **UI-BUILT** = HTML/CSS exists in popup, logic not wired | **PLANNED** = not yet started | **PARTIAL** = some code exists

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
