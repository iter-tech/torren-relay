# Amazon Relay Selectors

Pull stable selectors from AMAZON_DOM_REFERENCE.md.
Update here if Amazon changes layout. Record verification date.

## Refresh button ✅
Verified: 2026-06-02
Location: bottom-right of load board, adjacent to "Next Refresh Xs" countdown text.
No stable id, no data-testid, no aria-label on the button itself. css-XXXX classes
are auto-generated and must NOT be used. Use fallback chain below.

Strategy 1 (primary):
  Find every <p> element whose textContent includes "Next Refresh".
  Take its parentElement and call querySelector('button') on it.
  Anchor: the "Next Refresh" countdown text — stable Amazon-owned string.

Strategy 2 (SVG fallback):
  Find every <path> element. Match its d attribute against the refresh icon geometry:
    d = "M20.128 2l-.493 5.635L14 7.142M19.44 6.935a9 9 0 101.023 8.134"
  Call .closest('button') on the matching path.
  Anchor: SVG path geometry — does not change with CSS rebuilds.

If both strategies fail: log error, return null, do NOT attempt click.
Implementation: content/refreshManager.js → findRefreshButton()

## Filter button / left filters panel ✅
Verified: 2026-08-05
Used by: `content/panelCloser.js` → `collapseFilterPanel()`

```html
<button type="button" mdn-popover-offset="-9" class="css-14evw8c">
  …<span aria-label="Filter  " role="img">…
</button>
```

**Lookup (no hash dependency):**

```js
const icon = Array.prototype.find.call(
  document.querySelectorAll('[role="img"][aria-label]'),
  el => el.getAttribute('aria-label').trim() === 'Filter'
);
const btn = icon && icon.closest('button');
```

- `aria-label` is on the inner **`<span role="img">`**, NOT on the button. Three June 2026
  attempts all used `button[aria-label="Filter"]`, which matches nothing — that is why they
  failed.
- The label carries **trailing spaces** (`"Filter  "`). Compare trimmed, never with `=`.
- `css-14evw8c` is a generated CSS-in-JS hash. **Never select on it.** Recorded here only as
  evidence of what was captured.

### THE PANEL ITSELF IS THE STATE — captured 2026-08-05
```
panel OPEN      →  div.filters__column   PRESENT
panel COLLAPSED →  div.filters__column   ABSENT entirely
```
Amazon **unmounts** the panel rather than hiding it. Both states captured in the same session
with no reload. So the state test is presence, one line, no ambiguity:

```js
const panel = document.querySelector('div.filters__column');
if (!panel) return;   // already collapsed — do not click, the button is a toggle
```

**⚠️ THE BUTTON CARRIES NO STATE.** Its attributes are **byte-identical open vs collapsed**:
`type="button"`, `mdn-popover-offset="-9"`, `class="css-14evw8c"`. There is **no
`aria-expanded`** on it or anywhere related to it. Do not go looking for one — this was checked
live and it does not exist. Use `div.filters__column` above instead.

**Do not reintroduce layout measurement.** An earlier implementation (2026-08-05, same day)
derived the state from a load card's `getBoundingClientRect().left` before and after clicking,
with a dead band, and clicked a **second** time to revert when it guessed wrong — which made the
panel flash open and shut whenever it was already collapsed. It was deleted the same day.
Pixel measurement is unreliable across monitors and zoom levels and is not needed: presence
answers the question outright. See SAFETY.md → Click 4.

## ⚠ TWO load-lists: main results vs Similar matches ✅
Verified live: 2026-08-12 · **structure captured 2026-08-13**

### The captured structure — copy this, do not re-derive

```
div.css-ftr0v1                                  <- hash class, NEVER select on it
├── div#search-results-summary-panel            <- id + class 'search-results-summary__panel'
│     └── ... <p>Showing 1 - 2 of 2 results</p>
├── div.<hash>
│     ├── div.load-list                         <- MAIN RESULTS
│     └── div.pagination-bar
└── div.<hash>
      ├── p  "Similar matches (4)"
      └── div.<hash> > div.load-list            <- SIMILAR MATCHES (ignore forever)
```

### 🔑 `search-results-summary` is a SIBLING anchor, NOT a container

**The summary panel does not contain the results.** An implementation that walked *up* from each
`div.load-list` looking for that token found nothing and read **zero cards** on every cycle
(`"main results panel not found {loadListsInDocument: 2}"`).

**Correct approach:** `document.getElementById('search-results-summary-panel')` (fallback: an
element whose `className` contains `search-results-summary__panel`), then walk its **following
siblings** in document order and take the first `div.load-list` found. The main results are in the
next sibling block; the Similar-matches list is in a later one, so document order separates them.
If no panel or no list is found: **read nothing** and warn. Never fall back to the whole document.

**Do NOT anchor on text.** "Recently added" is not always rendered. "Similar matches" is localised
across all 11 Relay domains. Both are unusable as anchors.

### 📌 The 10-of-10 capture (2026-08-13) — the recently-added card's class

On a board reading **"Showing 1 - 10 of 10 results"**, the main list held exactly **10 children**:

| Count | Class |
|---|---|
| 9 | `div.load-card` |
| **1** | **`div.wo-card-header--highlighted`** — the recently-added card, at **index 4** |

**The highlighted card is a DIRECT CHILD here, not an inner wrapper.** That is the case
`content/loadParser.js` must catch, and its selector list already does:

```js
'div.load-card, div.load-card__selected, div.wo-card-header--highlighted'
```

**There is no silent alert-miss.** A newly-added load rendered with this class IS parsed, so it
reaches `detectNewLoads` → highlight + sound. Do not "simplify" that selector list to the first
two — the third is what catches the new load, which is the one the dispatcher most needs.

⚠ Note the same class can ALSO appear as an inner child of a `.load-card`. `parseLoads()` handles
both shapes with its `contains()` dedupe, keeping only the outermost match.

### 🔑 Count cards by ID SHAPE, not by card class

Measured on a live "9 of 9" board:

| Selector | Found |
|---|---|
| `div.load-card, div.load-card__selected` | **8** ❌ |
| `div[id]` filtered to bare UUIDs | **9** ✅ |
| board's own "of N results" | **9** |

The recently-added/highlighted card carries a **different class**, so any class-based count
silently loses it. Every card's join id is a bare UUID:

```js
/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

**The UUID filter is load-bearing:** cards also contain `div[id="STARTING_SOON"]`, which is not a
joinable id and must never reach the assignment.

Reference implementation: `findMainResultsList()` / `readRenderedCardIds()` in
`content/cityAssign.js`.

---

### Earlier note (2026-08-12) — why this matters

**The board contains TWO `div.load-list` elements.** One holds the main results, the other holds
the "Similar matches" block (wrapper structure documented in `content/filterSimilar.js`).

**`document.querySelector('div.load-list')` — first in document order — is NOT reliably the main
list.** This caused a real, long-lived bug: on a board showing "9 of 9 results" a reader using
that selector collected **13** cards, the extra 4 being similar-matches cards. Those never appear
in the `/api/loadboard/search` response, so they could never join it — the id intersection sat at
0/N and was misdiagnosed for several rounds as a pagination, join-key and endpoint problem in
turn.

| | Selector |
|---|---|
| **Main results list** | the `div.load-list` whose ancestry contains the token **`search-results-summary`** in its `class` or `id` |
| **Similar-matches list** | the `div.load-list` OUTSIDE that panel |

Match `search-results-summary` as a **substring of class or id**. Do **not** use the `css-<hash>`
class beside it — those rotate on every Amazon deploy.

**Walk UP from each `div.load-list` looking for the panel**, rather than down from a guessed
container: it is indifferent to how many wrapper divs Amazon puts in between.

**If the panel is not found, read nothing.** Falling back to the whole document silently
re-includes the similar cards, which is the bug itself.

### Stop location — the card's own origin city ✅ (recorded 2026-08-13)

**Source: `samples/paired-card.html`**, the captured live card. Not inferred.

```
span[tabindex="0"] span.wo-card-header__components     ← primary
span[tabindex="0"]                                     ← fallback
```

Take the **first in document order** — that is stop 1, the origin. Structure as captured:

```html
<span tabindex="0"><p><span class="wo-card-header__components">XMD2 JOLIET, IL 60436-8548</span></p></span>
...
<span tabindex="0"><p><span class="wo-card-header__components">CMH3 MONROE, OH 45050-1848</span></p></span>
```

**⚠ `.wo-card-header__components` ALONE IS NOT A LOCATION SELECTOR.** It appears **7 times** in
that one card and also wraps:

| text | what it is |
|---|---|
| `XMD2 JOLIET, IL 60436-8548` | stop 1 location ✅ |
| `CMH3 MONROE, OH 45050-1848` | stop 2 location ✅ |
| `Tue Aug 4 01:30 CDT` | stop time ❌ |
| `314.0 mi` | trip distance ❌ |
| `7h 6m` | duration ❌ |
| `$2.35/mi` | rate ❌ |

`span[tabindex="0"]` is the discriminator: the two locations are focusable, none of the other
values are. There are **exactly two** in the captured card.

**Text format:** `<FACILITY CODE> <CITY>, <ST> <ZIP>`. The code is optional and, where present in
the capture, always contains a digit (`XMD2`, `CMH3`, `TUL2`). Parse to `CITY, ST` and geocode;
a code with no digit would be absorbed into the city name and fail to geocode, which leaves the
card unassigned and visible — the safe direction. Reference implementation: `readCardOrigin()` /
`parseStopCityState()` in `content/cityAssign.js`.

**This replaced the network capture as the source of a card's city.** The response-based chain
broke on pagination, aborted requests and saved-search tabs; the card always has this text.

### ⚠ The "Showing" line carries TWO numbers, not one (recorded 2026-08-13)

`Showing 1 - 50 of 230 results` is **a rendered range AND a grand total**:

| part | meaning | example |
|---|---|---|
| `1 - 50` | how many cards are **on screen right now** | 50 rendered |
| `of 230` | how many exist **across all pages** | 230 total |

They are equal **only on a single-page board**, which is what made this expensive: every live test
(9 of 9, 30 of 30) passed while every real paginated board failed. Real values measured from the
captures in `samples/`:

| capture | records in response | `nextItemToken` | `totalResultsSize` |
|---|---|---|---|
| `paired-search.json` | 50 | 50 | **338** |
| `search-5cities-active.json` | 50 | 50 | **104** |
| `search-5cities-other.json` | 5 | 5 | **11** |

**One response carries one page.** Note the third row — this is not a "big board" problem: an
11-result board split the same way.

⚠ **The page size is NOT fixed.** 4, 5 and 50 records per response have all been observed
(api-samples.md §6.5). Never hardcode it — compare against the RENDERED range below.

**Cross-check available, and its correct form:** the main list's card count must be **≤ the
RENDERED count**, never compared against the grand total. More than rendered means cards from
outside the main list leaked in. Fewer is normal. A range that cannot be parsed must not disable
anything — warn and proceed. Reference implementation: `findMainResultsList()` /
`readShowingCounts()` in `content/cityAssign.js`.

Parse notes: the range dash may be any of U+002D or U+2010–U+2015, spaces around it are optional
(`1-50` occurs), thousands separators appear (`1,250`), and the noun is singular at one result
(`1 result`). Anchor on the word *Showing* and the digits, never on the surrounding markup.

> **`content/loadParser.js:124` still makes the old assumption** (`document.querySelector('div.load-list')`).
> It feeds highlighting and alerts and has not been audited against this finding.

## Load card (Layout A) ✅
Verified: 2026-06-02
Container:        div.load-card, div.load-card__selected  (both states)
Load ID:          card.querySelector('div[id]')?.id  (UUID string)
Payout:           .wo-total_payout, .wo-total_payout__match-deviation-attr  → "$427.61" / "$309.08"
                  TWO inner classes — see "Payout inner-class family" below. Matching only the
                  first one silently produced payout=null for the whole Similar-matches section.
Price per mile:   .wo-card-header__components where textContent includes "/mi"  → "$1.84/mi"
Distance:         .wo-card-header__components where textContent includes "mi" but NOT "/mi"  → "104.0 mi"
Duration:         .wo-card-header__components matching /\d+[dh]/ and not containing "mi"  → "2h 52m"
Stops (locations): .wo-card-header__components where textContent includes ", " but NOT "/mi"  → ["CMH3 MONROE, OH...", ...]
Equipment:        .equipment-type-text  → "53' Trailer"
Trailer circle:   .trailer-type-circle  → "P"  (may be absent)
Loading type:     .loading-type  → "Drop", "Live", "Live/Drop", or "Drop/Live"
                  Combined value appears in both orderings on the live board — treat as order-insensitive.
Deadhead:         previousElementSibling of span[title="Deadhead"]  → "32.31 mi"
Tag:              #STARTING_SOON or .wo-tag  → "Starting soon"  (may be absent)
Price increase:   .wo-total_payout__modified-load-increase-attr  (Amazon's own highlight)
                  ⚠ SUSPECTED third member of the payout family below — NOT yet matched by the
                  parser. See the family note.
Implementation:   content/loadParser.js → parseLoads()

### Payout inner-class family ⚠ (captured 2026-07-31)

The payout value is wrapped in an outer span with generated CSS-in-JS hashes and an inner span
carrying a **semantic `wo-*` class that varies by board section**. Only the inner `wo-*` class is
stable — **never** select on the `css-*` hashes, they change on every Amazon deploy.

**Similar matches section (captured live, 2026-07-31):**

```html
payout:      <span class="css-jarjh1 css-icpham"><span class="wo-total_payout__match-deviation-attr">$309.08</span></span>
price/mile:  <span class="css-1tddwld css-n4zms0"><span class="wo-card-header__components">$4.23/mi</span></span>
```

**Main board:** `<span class="wo-total_payout">$427.61</span>`

Known/suspected members:

| Inner class | Where | Matched by the parser? |
|---|---|---|
| `wo-total_payout` | main load list | ✅ yes |
| `wo-total_payout__match-deviation-attr` | Similar matches | ✅ yes (added 2026-07-31) |
| `wo-total_payout__modified-load-increase-attr` | price-increase highlight | ❌ **no — unverified** |

**Why a whole-token match matters:** `wo-total_payout__match-deviation-attr` is a single
indivisible class token, *not* `wo-total_payout` plus a suffix, so `.wo-total_payout` does not
match it. That is why the entire Similar-matches section parsed with `payout = null`.

**Why the third is deliberately not matched:** no capture proves it is the payout element itself
rather than a separate badge on the card. `querySelector` returns the first match in DOCUMENT
order, so if it is a badge sitting before the payout, adding it would make price-increased loads
report the WRONG number — worse than the current null. **To resolve:** capture the full inner
HTML of a card showing a price increase and check whether that class is on the payout span or a
sibling. If it is the payout span, add it to the selector in `loadParser.js` — a one-token change.

**Other fields in the Similar-matches section:** the capture shows price/mile using the ordinary
`wo-card-header__components`, and per the report so do cities, times, distance and duration — so
those parse normally there. **Not verified from any capture** are the non-`wo-*` selectors this
parser also depends on: `.equipment-type-text`, `.trailer-type-circle`, `.loading-type`,
`span[title="Deadhead"]`, `#STARTING_SOON` / `.wo-tag`, and `div[id]` for the load ID. If any of
those also differ inside this section, they fail the same silent way. Worth one capture of a
complete Similar-matches card to confirm.

## Tour container / Contracts (Layout B) — INTENTIONALLY IGNORED ⛔
Container: [data-type$="-tour-container"]
Rows: data-tag="offer-row"

Layout B (Contracts / Block view) is OUT OF SCOPE for this MVP.
This extension does NOT parse, interact with, or display Layout B data.
Contracts/Block is a future separate project with its own spec.
Selectors listed above for reference only — do not use in extension code.

## Booking (FORBIDDEN — never click) ⚠️
Book button (Load Board):   #rlb-book-btn
Confirm booking:            #rlb-book-trip-confirm-booking-btn
Cancel booking:             #rlb-book-trip-no-btn
Book button (Contracts/Layout B): #book-btn-row — Layout B / Contracts view — OUT OF SCOPE for MVP, but guarded.

All four selectors are in FORBIDDEN_SELECTORS (utils/constants.js).
isForbiddenElement() blocks any .click() call that targets these elements.
#book-btn-row is guarded as a paranoid safety measure even though Layout B
is not targeted — the extension must never book regardless of which view is active.

## Relay internal API endpoints (PAT — confirmed from live captures)

Used by `content/patApi.js` via same-origin `fetch`. CSRF read live from `<meta name="x-owp-csrf-token">`; sent as request header `x-csrf-token`.

| Constant | Path | Purpose |
|----------|------|---------|
| `PAT_UPSERT_PATH` | `/api/loadboard/orders/upsert` | POST — create truck post (carrier offer). |
| `CITY_SEARCH_BASE` | `/api/loadboard/filters/cities/search/<encodeURIComponent(city)>` | GET — city resolution (not autocomplete). |

**City search response shape (confirmed from live API):**
Array of objects: `{ name, stateCode, country, latitude, longitude, nearestDomicileCode, displayValue }`.

⚠️ `displayValue` is ALWAYS `null` in this API — never use it directly. Build it manually: `"${name}, ${stateCode}"`.
`uniqueKey` must also be built manually: `"${latitude}${displayValue}"` (after building displayValue).

boardStops string format: `"JAX9 JACKSONVILLE, Florida 32221-8118"`. Drop first token (warehouse code), split on comma: city = left, state portion = right (strip trailing ZIP first — state may be full name "Florida" or abbrev "FL" → normalize via `STATE_NAME_TO_CODE`).

Additional observed patterns handled by `parseBoardStop`:
- Full state name prefixed before city: `"ILL1 Illinois AURORA, IL 60505"` → `{ city:"AURORA", state:"IL" }`. Detected by checking if city string starts with a `STATE_NAME_TO_CODE` key + space (checked longest-first via `STATE_NAMES_SORTED`).
- Dotted abbreviations (`"MT. JULIET"`, `"ST. LOUIS"`, `"FT. WAYNE"`) are NOT stripped in `parseBoardStop` — they are sent verbatim to the city search API. If the API returns no match, `resolvePATCity` expands `MT.→MOUNT`, `ST.→SAINT`, `FT.→FORT` and retries the search.

**POST body shape (confirmed from live cURL capture — MEMPHIS→LEBANON):** see `buildPatPayload()` in `content/patApi.js` for canonical structure.

Key structural notes (mismatches that caused HttpMessageNotReadableException):
- `totalCost`: `{ value, unit:"USD" }` — key is `unit`, not `currency`
- `costPerDistance`: `{ value, currencyUnit:"USD", distanceUnit:"mi" }` — key is `currencyUnit`; distanceUnit is `"mi"` (lowercase), not `"MILES"`
- `minDistance`/`maxDistance`: `{ value, unit:"mi" }` — NOT bare numbers
- `originCityRadius`/`destinationCityRadius`: `{ value, unit:"mi" }` — NOT bare numbers
- `originCityInfo`: single object (NOT an array) `{ name, stateCode, country, latitude, longitude, displayValue, isCityLive:false, isAnywhere:false, uniqueKey }`
- `endLocationList[0]`: `{ displayValue, stateCode, isCityLive:false, latitude, longitude, name }` (no country/isAnywhere/uniqueKey)

Static fields (all confirmed): `runType:"ONE_WAY"`, `distanceOrDuration:"DISTANCE"`, `payoutType:"FLAT_RATE"`, `driverTypes:["SOLO"]`, `visibleProvidedTrailerType:"AMAZON_PROVIDED"`, `providedTrailerType:"AMAZON_PROVIDED"`, `isLinkedOrder:false`, `isRepostingAllowed:true`, `isAnywhereDestination:false`, `matchingDemands:[]`, `matchingWork:0`, `isCheckingMatchingWork:false`, `isMatchingWorkLoaded:false`, `supplyDriverIdList:[]`, `supplyTransientDriverIdList:[]`, `exclusionCityList:[]`, `endRegionList:[]`, `startTimeWindow:null`, `minDurationInMinutes:null`, `maxDurationInMinutes:null`, `destinationCityInfo:null`, `destinationCityInfoForFilter:null`, `auditMetaData:{suggestedCostPerDistance:null,matchOutlookScore:"LOW"}`, `patOrderContext:null`, `cancellationDetails:null`, `repostingDetails:null`.

## PAT form (Amazon DOM — NOT used by extension)
Extension bypasses Amazon's PAT form and POSTs directly to the API above. No Amazon form selectors needed.

## Neutral zone (Stage 13)
The load card itself (div.load-card) — clicking opens details panel.
NOT the payout, NOT the chevron, NOT any button.

## MutationObserver anchor ✅
Used by: content/loadObserver.js → startLoadObserver()

Anchor: `document.body`
Reason: `div.load-list` is VOLATILE — when the user changes a filter, Amazon (React SPA)
unmounts the entire div.load-list and mounts a fresh one. An observer bound to the old node
goes permanently deaf once that node is detached. document.body is the only unconditionally
stable anchor that survives any React re-render.

Observed config: `{ childList: true, subtree: true }`
- subtree:true required to catch replacements deep in the component tree.
- No attributes:true — highlighter class additions (.ext-new-load) are attribute mutations
  and do NOT fire this observer.

Mutation filter (hasExternalChange()):
  Fires the debounce for ANY childList mutation involving a non-ext-managed node.
  No class-name matching — Amazon wraps the load-list in React containers whose root
  nodes have dynamic/hashed classes; class-name filtering caused false negatives.
  "Was it actually a new load?" is answered by detectNewLoads() after the debounce, not
  in the observer callback. Non-load Amazon mutations (if childList) trigger a pipeline
  pass that finds newCount=0 and exits silently.

Self-trigger guard (isExtManagedNode()):
  Returns true for: non-element nodes, id='ext-inline-panel', id/data-testid starting with 'ext-'.
  These are skipped before the filter above runs.

DIAG logs removed 2026-06-18 after observer behavior was confirmed; standard logger.log entries remain.

⚠️ Re-verify if Amazon changes the overall page structure (not just the load list).

## Detail panel (load-detail sheet) close ✅
Authorized: 2026-06-18 — see docs/SAFETY.md Click 3.
Panel open-check: `document.querySelector('#selected-work-sheet')` is non-null.
`#selected-work-sheet` is a stable element ID (not a CSS hash class).

Strategy 1 (primary — aria-label):
  `sheet.querySelectorAll('button[aria-label]')` → first whose aria-label (lowercase)
  contains "close".

Strategy 2 (icon-only fallback):
  `sheet.querySelectorAll('button')` → first with no text content and an `svg` child.

If no strategy resolves: log and skip — no click.
`isForbiddenElement()` is called on the resolved button before every click.
Implementation: content/panelCloser.js → findDetailCloseButton()
⚠️ Re-verify selector if Amazon changes the detail sheet markup.

## Detail sheet content (inlinePanel readSheetData) ⚠ FRAGILE

Verified: 2026-06 (approximate; Amazon rebuilds hashed classes without notice)
Implementation: content/inlinePanel.js → readSheetData(), parseStopBlock()

**Exception to the no-css-hash rule:** these are hashed `css-XXXX` class names. No stable
`data-testid`, `aria-*`, or `id` alternative was found for any of them. A selector-drift
alarm is wired in code (`SELECTOR DRIFT SUSPECTED` warn) to surface breakage immediately.

| Selector | Used for |
|----------|----------|
| `#selected-work-sheet` | Sheet container — stable `id`, NOT a hash class |
| `.load-expander` | One per segment — stable non-hashed class |
| `.expander-content` | Stop rows container within a segment |
| `.css-ntd8uw .css-1q48g4q` | Header summary (stopsCount / totalMiles) |
| `.css-6hcxnp` | Payout text in sheet header |
| `.css-17jtd1r` | Stop label pair in segment header (from / to) |
| `.css-424exj` | Stop facility code inside a `.css-17jtd1r` |
| `.css-14f9df9` | Miles text in segment header |
| `.css-gudqq2 .css-1cp4is8` | Duration text (bullet-separated) |
| `.css-zgauvq` | Individual stop block inside `.expander-content` |
| `.css-w1kk5u` | Address container inside a stop block |
| `.css-1cbogyo` | Equipment/load-type text inside a stop block |
| `.scheduled-arrival__time .scheduled-time` | Arrival time — partially stable class |
| `.scheduled-departure__time .scheduled-time` | Departure time — partially stable class |

⚠️ Re-verify ALL hashed selectors whenever Amazon deploys a CSS rebuild.
   The drift alarm (`logger.warn 'SELECTOR DRIFT SUSPECTED'`) fires in readSheetData()
   if the sheet is present but expanders are absent, or if all segments parse empty.
