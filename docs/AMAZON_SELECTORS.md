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

## Load card (Layout A) ✅
Verified: 2026-06-02
Container:        div.load-card, div.load-card__selected  (both states)
Load ID:          card.querySelector('div[id]')?.id  (UUID string)
Payout:           .wo-total_payout  → "$427.61"
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
Implementation:   content/loadParser.js → parseLoads()

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
