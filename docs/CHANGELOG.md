# Changelog

## [Unreleased]

### 2026-07-08 — BUG FIX: "startLocationList" → "originCityInfo" (invented key, wrong shape)

Files changed: `content/patApi.js` (`buildPatPayload`).
Docs updated: `AMAZON_SELECTORS.md`, `CHANGELOG.md`.

The origin city was sent as `"startLocationList": [{ ... }]` — an invented key wrapping the object in an array. The capture has `"originCityInfo": { ... }` — a single object at the top level, no array. Fixed: key renamed, array brackets removed. No change to the object's field set.

---

### 2026-07-08 — BUG FIX: buildPatPayload structural mismatch → HttpMessageNotReadableException

Files changed: `content/patApi.js` (`buildPatPayload`).
Docs updated: `AMAZON_SELECTORS.md`, `CHANGELOG.md`.

Server returned HTTP 400 `HttpMessageNotReadableException` — the server could not deserialize the JSON body due to structural mismatches (wrong key names / bare numbers where objects were expected).

**Keys corrected (4 confirmed mismatches from live capture):**
- `totalCost`: `currency:"USD"` → `unit:"USD"`
- `costPerDistance`: `{value, distanceUnit:"MILES"}` → `{value, currencyUnit:"USD", distanceUnit:"mi"}`
- `minDistance` / `maxDistance`: bare number → `{value, unit:"mi"}`
- `originCityRadius` / `destinationCityRadius`: bare number → `{value, unit:"mi"}`

**City object shapes corrected:**
- `originCityInfo`: was invented as `startLocationList:[{...}]` (array) — capture has `originCityInfo:{...}` (single object). Corrected 2026-07-08.
- `endLocationList[0]`: was passing full object — capture requires stripped shape: `{displayValue, stateCode, isCityLive:false, latitude, longitude, name}` (no country/isAnywhere/uniqueKey)

**Static fields added (previously absent, all confirmed from live capture):**
`runType:"ONE_WAY"`, `distanceOrDuration:"DISTANCE"`, `payoutType:"FLAT_RATE"`, `visibleProvidedTrailerType:"AMAZON_PROVIDED"`, `providedTrailerType:"AMAZON_PROVIDED"`, `isLinkedOrder:false`, `isRepostingAllowed:true`, `isAnywhereDestination:false`, `matchingDemands:[]`, `matchingWork:0`, `isCheckingMatchingWork:false`, `isMatchingWorkLoaded:false`, `supplyDriverIdList:[]`, `supplyTransientDriverIdList:[]`, `exclusionCityList:[]`, `endRegionList:[]`, `startTimeWindow:null`, `minDurationInMinutes:null`, `maxDurationInMinutes:null`, `destinationCityInfoForFilter:null`, `auditMetaData:{suggestedCostPerDistance:null,matchOutlookScore:"LOW"}`, `patOrderContext:null`, `cancellationDetails:null`, `repostingDetails:null`.

No change to `submitOrder`, `resolvePATCity`, `resolveLoadingType`, or any other function.

---

### 2026-07-07 — BUG FIX: submitOrder was posting to an invented endpoint

Files changed: `content/patApi.js` (constant + fetch headers).
Docs updated: `AMAZON_SELECTORS.md`, `BACKLOG.md`, `STATE.md`, `CHANGELOG.md`.

**Root cause:** `PAT_UPSERT_PATH` was set to `/relay/rlb/api/pat/create-order` — a path that exists in no live capture and no doc. The correct endpoint, confirmed from a fresh cURL of a real manual Post-a-Truck submission, is `/api/loadboard/orders/upsert`. The wrong endpoint caused 400 InvalidCsrfTokenException because it rejected the CSRF token from the real domain.

**Fix — `content/patApi.js`:**
- `PAT_UPSERT_PATH` → `/api/loadboard/orders/upsert`
- Request header corrected: `x-owp-csrf-token` → `x-csrf-token` (header name confirmed from live capture; meta tag name `x-owp-csrf-token` is unchanged — we read from it, but send as `x-csrf-token`)
- Accept header corrected: `application/json` → `*/*` (confirmed from live capture)
- No Referer header added — browser sends it automatically for same-origin fetch

**Amazon URLs the feature contacts (complete list):**
1. `POST /api/loadboard/orders/upsert` — order creation
2. `GET /api/loadboard/filters/cities/search/<city>` — city resolution
3. `<meta name="x-owp-csrf-token">` — CSRF read (DOM, no network request)

---

### 2026-07-07 — PAT: loadingType combined value is order-insensitive

Files changed: `content/patApi.js` (`resolveLoadingType`).
Docs updated: `AMAZON_SELECTORS.md`, `CHANGELOG.md`.

Live board shows combined loadingType in both orderings: `"Live/Drop"` (previously captured) and `"Drop/Live"` (captured today, blocked by the guard). `resolveLoadingType` now splits on `/`, trims each token, maps `"Drop"→DROP` / `"Live"→LIVE`, and returns `null` on any unrecognized token. When both tokens are present (in any order) the return value is always `["LIVE","DROP"]` — fixed order to match the captured upsert payload. The null-guard behavior is unchanged: an unrecognized token still produces `null`, which the modal surfaces as a blocking error.

---

### 2026-07-07 — PAT on-demand parse: fix nested-card element resolution

Files changed: `content/inlinePanel.js` (new `findLiveOutermostCard` helper + post button handler).
Docs updated: `CHANGELOG.md`, `TEST_CASES.md`.

**Root cause:** `initManualToggle` captures the card element via `ev.target.closest('div.load-card, div.load-card__selected')` — this returns the **innermost** matching ancestor. When Amazon nests `div.wo-card-header--highlighted` inside `div.load-card` (the exact nesting the `parseLoads` dedup was added for), the captured element is the inner node. It contains `div[id]` (Phase 2 / loadId work), but NOT `.equipment-type-text` / `.wo-total_payout` / `.wo-card-header__components` — so `parseOneCard()` on it returns all Phase 1 fields as null. After one loop tick `parseLoads` has merged Phase 1 under the correct outermost loadId, `needsPhase1` becomes false, and the broken on-demand branch is skipped — masking the bug. A stale-after-React-remount `cardElement` is covered by the same fix.

**Fix — `findLiveOutermostCard(loadId)`** (new function, before `showInlinePanel`):
1. `document.getElementById(loadId)` — always live DOM.
2. `.closest('div.load-card, div.load-card__selected')` — nearest card ancestor.
3. Climb via `parentElement.closest(…)` loop to the **outermost** matching container — mirrors `parseLoads` `allCards.filter(elB.contains(elA))` pass.
Selectors: `div.load-card, div.load-card__selected` — identical to the `parseLoads` querySelectorAll pair. `div.wo-card-header--highlighted` excluded: always inner, never outer (parseLoads contains-filter drops it). Returns `null` if `getElementById` finds nothing.

**Fix — post button handler** (inside `showInlinePanel`):
Calls `findLiveOutermostCard(sheetLoadId)` before `parseOneCard`. Logs `usedLive` and `sameNode` at the "Phase 1 missing" log line. Passes `liveCard || cardElement` to `parseOneCard`. Empty-parse error log now includes `usedLive` and `sameNode` for diagnostics.
No change to `initManualToggle`, `parseLoads`, camera/map handlers, PAT modal, or patApi.js.

---

### 2026-07-07 — PAT modal: on-demand Phase 1 parse when loop was never started

Files changed: `content/inlinePanel.js` (post button handler), `content/patModal.js` (equipment gate).
Docs updated: `TEST_CASES.md`, `STATE.md`.

**Problem:** when the dispatcher opens a card and clicks Create Post without ever starting the refresh loop, `parseLoads()` has never run and the LoadUnit has no Phase 1 board fields (payout, boardStops, equipment, distance, loadingType all null). The modal correctly refused with equipment «» unsupported, but the message was confusing.

**Fix — `content/inlinePanel.js`** (`showInlinePanel`, post button handler):
Before calling `openPostModal(sheetLoadId)`, checks `loadStore.getLoadUnit(sheetLoadId)` for missing Phase 1 (equipment null/'' OR boardStops empty). If missing, calls `parseOneCard(cardElement)` directly — confirmed standalone-safe (no knownLoadIds write, no detection pipeline, no tabState, no sound). Replicates the exact `loadStore.mergeLoadUnit(…)` call that `parseLoads()` would have made, including the `boardStops: parsed.stops` field name. Detection state is untouched. If on-demand parse also yields empty equipment/boardStops (unexpected card layout), logs `logger.error` with `outerHTML.length` and `loadId` for diagnostics, then proceeds to `openPostModal` which will show the user-facing error.

**Fix — `content/patModal.js`** (equipment gate):
Split the `equipment !== "53' Trailer"` branch into two cases:
- `!equipment` (empty string after on-demand parse failed) → `showSimplePatModal("Could not read load data from this card — start the refresh loop once, or report this card layout to the PM.", 'pat-no-equipment')` + `logger.error`.
- non-empty unsupported equipment → existing "not supported yet: «X»" message unchanged.

No change to form logic, payload assembly, patApi.js, or any detection/booking path.

---

### 2026-07-07 — PAT Modal + API rework (LoadFetcher parity, data mapping fixed)

Files changed: `content/patApi.js` (full rewrite), `content/patModal.js` (full rewrite).
Docs updated: `UI_ELEMENTS.md`, `AMAZON_SELECTORS.md`, `BACKLOG.md`, `STATE.md`.

**Reason for rework:** the first implementation (2026-07-06) was confirmed broken by live testing — wrong field names (`payout` vs `payoutNum`), wrong data sources (stop addresses vs `boardStops`), invented equipment labels, missing form fields, and silent markup exposed as a UI label.

All old functions removed: `parseCityState`, `parsePickupDate`, `parseCityStateFromInput`, `wirePatCitySearch`, `CITY_DEBOUNCE_MS`, `resolveEquipmentCode`, `searchCity`, `buildCityInfo`, `buildOrderPayload`, `EQUIPMENT_EXPANSION`, `CITY_SEARCH_PATH`.
Old testids removed: `pat-origin-input`, `pat-dest-input`, `pat-date-input`, `pat-equipment-select`, `pat-markup-note`, `pat-origin-suggestions`, `pat-dest-suggestions`, `pat-city-suggestion`.

No new `.click()` sites. No new manifest permissions. No Amazon DOM interaction. All text via `textContent`.

**patApi.js** (full rewrite — network layer):
- `STATE_NAME_TO_CODE` — full 50+DC table. `normalizeState(s)` — "Florida"→"FL", "FL"→"FL".
- `parseBoardStop(str)` — "JAX9 JACKSONVILLE, Florida 32221" → `{city:"JACKSONVILLE",state:"FL"}`. Drops warehouse code, splits on comma, normalizes state.
- `parsePatStopTime(timeStr)` — "07/10 10:42 EDT" → `{date:Date(UTC), tzName, tzOffset}`. Returns `{tzError}` on unknown TZ; null on unrecognized format. Year rollover if >30 days past.
- `getCsrfToken()` — reads live from `<meta name="x-owp-csrf-token">`, never hardcoded.
- `resolvePATCity(boardStopStr)` — `GET /api/loadboard/filters/cities/search/<city>` (confirmed path). API returns `{name,stateCode,country,latitude,longitude,nearestDomicileCode,displayValue:null}` — `displayValue` is ALWAYS null; built manually as `"${name},${stateCode}"`. Matches by exact name+stateCode, then prefix+stateCode fallback.
- `resolveLoadingType(str)` — "Drop"→["DROP"], "Live"→["LIVE"], "Live/Drop"→["LIVE","DROP"]; null for unknown.
- `buildPatPayload(formState)` — full upsert POST body (confirmed fields from live capture).
- `submitOrder(payload)` — POST to `/api/loadboard/orders/upsert` (confirmed path — earlier draft used invented path `/relay/rlb/api/pat/create-order`, corrected 2026-07-07).

**patModal.js** (full rewrite — UI layer):
- `PAT_TEST_MARKUP_USD = 5000` — silent, no label anywhere. Default payout = `payoutNum + 5000`.
- Equipment gate: only "53' Trailer" shows form; any other equipment → `showSimplePatModal(unsupported notice)`, no form, no network. `logger.warn` with equipment string.
- `makeTimeStepper(timeResult, testidBase)` — [−] [MM/DD HH:mm TZ] [+]; click span → datetime-local input; steps ±15 min. Returns `{el, getDate()}`.
- `openPostModal(loadId)` — async. Modal appears immediately with pre-parsed city name text; then `await Promise.all([resolvePATCity(o), resolvePATCity(d)])` resolves cities in background; guards `overlay.isConnected` before DOM update.
- Confirm disabled until cities resolve + no blocking errors (unknown TZ, unknown loading type).
- $/mi ↔ Payout linked via board distance (not min/max miles). Guard div/0.
- "Exclude Swing Door" checkbox (default checked → `excludeSpecialServices:["SWING_DOOR"]`).
- Success: green "Post created ✓" + modal fade-close after 2.5s. Error: red status, re-enable button.

**Unchanged from original implementation:** `inlinePanel.js` (post button wired correctly), `manifest.json` (load order correct).

---

### 2026-07-06 — Elevation-based dark theme rebuild (nightMode.js)

Files changed: `content/nightMode.js` (full rework), `content/priceSurge.js`.

Styling only — no behavior changes, no new `.click()` sites, no new Amazon selectors.

**Surface ramp** (4 levels, no green):

| Level | Value | Used for |
|---|---|---|
| base | `#16181c` | Page background only |
| raised | `#1e2126` | Load cards, nav header, footer, form inputs, buttons |
| overlay | `#262a31` | Selected card, detail panel, popovers, our inline panel |
| high | `#2e333b` | Stop data rows, segment headers, modal content, expanded rows |

**Text scale**: primary `#e8eaed`, secondary/placeholder `#a8b0b9`, disabled/labels `#6b7480`. Green tint removed from all text values.

**Key changes vs old theme**:
- All green-tinted color constants (`NIGHT_BG`, `NIGHT_CARD`, etc.) replaced with `DK_*` elevation ramp constants.
- Amazon header/banner/nav: was `#1a5c38` (green) → `DK_RAISED` (neutral dark). `NIGHT_HEADER` constant removed.
- Cards: `#1b201d` → `#1e2126` (raised) + `DK_BORDER` hairline each card.
- Selected card: `#2c332e` → `#262a31` (overlay) + strong border.
- Detail sheet: `#161b18` (was DARKER than cards, wrong) → `#262a31` (overlay, correctly elevated above cards).
- Stop rows in detail: `#121714` (near-black) → `#2e333b` (high — readable, elevated from overlay).
- Inline panel: `#161b18` → `#262a31` (overlay — sits at same level as detail sheet against raised card). Added explicit overrides for `.ext-seg-header` (high), `.ext-stop-num` (accent tint), `.ext-seg-loaded` (success), `.ext-seg-empty` (muted), `.ext-route-arrow` (muted), `.ext-action-bar` (overlay), `.ext-action-btn:hover` (high), `.ext-dot-loaded/empty`.
- Footer: was `#151a17` → `DK_RAISED`.
- Text: was `#e7efe9` (green tint) → `#e8eaed` (neutral); disabled labels `rgba(231,239,233,0.32)` → `#6b7480`.

**`content/priceSurge.js`**: Added `!important` to dark-override background (`rgba(212,167,44,.20)`) and badge color (`#f0c040`) — the nightMode.js universal reset was silently winning those properties.

**Uncovered blocks** (no stable selector; inheriting base bg is acceptable):
- Left filter panel: Amazon uses hashed CSS classes; it inherits base bg (`#16181c`) which gives correct base-level reading. No risky selector added.
- Load card `:hover` state: no hover-elevation rule added (risky selector territory). Cards stay raised on hover.

---

### 2026-07-06 — Bug: Sidebar dark mode ignored (root cause: nightMode.js !important override)

Files changed: `content/nightMode.js`, `content/sidebar.js`.

Root cause: `nightMode.js` `buildNightCss()` contained `html.ext-night #ext-sidebar{background-color:#1a5c38 !important}` — the old solid green with `!important`, which overrode the CSS-var-based tokens from `designTokens.js`. Three other stale night-mode values were also present: `.ext-new-load` used an old blue rgba, the pill used the old translucent-on-green rgba, and the scanline used the old green gradient.

- **`content/nightMode.js`** — updated 4 lines in `buildNightCss()`:
  - `.ext-new-load` dark: `rgba(120,180,235,0.20)` → `rgba(76,141,255,.15)` + inset left-rule `rgba(76,141,255,.8)` (matches new accent-bg highlight design)
  - `#ext-sidebar` bg: `#1a5c38 !important` → `#1c1f24 !important` + `color:#e5edf5 !important` (dark neutral surface)
  - `ext-playpause` pill: `rgba(255,255,255,0.15)` → dark neutral `#23272d`, border `#2c313a`, icon `#b0bcca`
  - Scanline gradient: old green `rgba(125,207,142,...)` → blue `rgba(76,141,255,...)`
  - `NIGHT_HEADER = '#1a5c38'` left intact — still used for Amazon's native `<header>`/`[role="banner"]`/`nav` (line 82), which is intentional in the night mode theme.

- **`content/sidebar.js`** — added `html.ext-night #ext-sidebar { … !important }` explicit dark override block (belt-and-suspenders; guards against future nightMode.js injection-order changes). Covers: bar bg/color/border/shadow, title color, pill (default + hover + running states), slider-value color, memory-indicator border, memory-info chip, tooltip bg/color.

Verification: grepping all `*.js` and `*.css` for `#1a5c38`, `rgba(125,207`, `rgba(26,92,56`, `#185FA5`, `rgb(182,227` — only `NIGHT_HEADER` constant remains (Amazon header, expected).

---

### 2026-07-06 — Design system: blue accent tokens, restyled sidebar / popup / inline panel / highlighter / surge

Files changed: `utils/designTokens.js` (new), `popup/popup.css` (full rewrite), `content/sidebar.js`, `content/inlinePanel.js`, `content/highlighter.js`, `content/priceSurge.js`, `popup/popup.js` (night-mode class wiring), `manifest.json`.

Styling only — zero behavior changes. No new `.click()` sites, no DOM structure changes, every `data-testid` preserved.

- **Token layer** (`utils/designTokens.js`, `manifest.json`, `popup/popup.css`): New file injects `<style id="ext-design-tokens">` with all `--ext-*` custom properties on `:root` and `html.ext-night` dark overrides. Listed FIRST in manifest content_scripts. Popup duplicates the token block at top of `popup/popup.css` (separate document — cannot share injected styles).
- **Accent pivot**: green `#1a5c38` → blue `#1a73e8` (dark `#4c8dff`). Green demoted to semantic success only (`--ext-success`). New neutral scale n100–n900.
- **Sidebar** (`content/sidebar.js`): Bar `#1a5c38` → `var(--ext-bar-bg)` (white/dark-surface) + n200 hairline + shadow-2. Title → `var(--ext-n900)`. Pill → n100 fill, n200 border, n700 icon; hover → n200; running state → accent fill + white icon. Slider/scanline → `var(--ext-accent)` (blue). Scanline gradient hardcoded RGB with `html.ext-night` dark override. `prefers-reduced-motion` scoped to `#ext-sidebar`. Memory dot border → n300; info icon → n100/n200/n700; tooltip → n900 bg / bar-bg text. Removed `--ext-scan-dur` declaration (now in token layer). `MEMORY_COLOR_NEUTRAL` → `#8fa1b2` (n400, visible on neutral bar).
- **Popup CSS** (`popup/popup.css`): Full rewrite. Toggles resized 40×24/20px knob (main) and 32×18/14px (small filters). Accent → `var(--ext-accent)`. Title → n900. Section labels → n500 uppercase. Sound block → n100 bg. Replay btn hover → accent. Focus rings → accent outline everywhere.
- **Popup night mode** (`popup/popup.js`): `document.documentElement.classList.toggle('ext-night', ...)` added in storage.get callback and in `onChanged` handler. Only JS change in this task.
- **Inline panel** (`content/inlinePanel.js`): Panel border → n200. Panel bg → `var(--ext-surface)`. Header → accent-bg / accent-text. Seg header → n100 bg, n200 border, n700 text. Route arrow → n400 (neutral, not green). Stop-number circles → accent-bg fill + accent-text (AA 5.5:1). `ext-seg-loaded` → `var(--ext-success)`. Action bar → n100 bg, n200 border. Action btn hover → n200/n900. `flashActionSuccess` SVG stroke `#1a5c38` → `#157347` (correct semantic success).
- **Highlighter** (`content/highlighter.js`): `rgb(182,227,255)` → `var(--ext-accent-bg)` + `box-shadow: inset 4px 0 0 0 var(--ext-accent)` left-rule.
- **Surge** (`content/priceSurge.js`): Green `#1a5c38` → semantic amber `#7a4f00` / `rgba(212,167,44,.12)`. Added `html.ext-night` overrides: `#f0c040` / `.20` opacity. Surge badge remains the one loud non-accent element.

---

### 2026-07-03 — Bug-fix pass: popup / sidebar / priceSurge / constants / storage (6 fixes)

Files changed: `popup/popup.html`, `popup/popup.js`, `content/soundAlert.js`, `content/sidebar.js`, `content/priceSurge.js`, `utils/constants.js`, `utils/storage.js`, `utils/soundDefs.js` (new), `manifest.json`.

- **FIX 1 — Auto-Open Top Load popup toggle** (`popup/popup.html`, `popup/popup.js`): Added `popup-auto-open` checkbox to popup (after Tab Alert row, same pattern). `KEY_AUTO_OPEN = 'autoOpenTopNew'`; loaded with `checked = data[KEY] !== false` (true-default); `onChanged` also uses `!== false`; reset sets `checked = true`. Corresponds to the existing `STORAGE_KEYS.AUTO_OPEN` key already consumed in `content.js`.
- **FIX 2 — Shared sound definitions** (`utils/soundDefs.js` new, `content/soundAlert.js`, `popup/popup.js`, `manifest.json`, `popup/popup.html`): Created `utils/soundDefs.js` exposing a global `var SOUND_DEFS` (25 entries with numbered comments — canonical version from soundAlert.js). Added to manifest content_scripts before `content/soundAlert.js`; added to popup.html before `popup.js`. Deleted `SOUND_DEFS` from `soundAlert.js`; `getSoundTones` now uses the global. Deleted `POPUP_SOUND_DEFS` from `popup.js`; `popupGetSoundTones` now uses the global. Both sound paths now guaranteed identical for the same soundId.
- **FIX 3 — toggleRunning reads tabState, not DOM attribute** (`content/sidebar.js`): `toggleRunning()` changed from `container.getAttribute('data-running') !== 'true'` to `!tabState.get('running')`. The DOM attribute is a *view* of the state (written by `reflectRunning`), not the authoritative source. Race condition: if `reflectRunning` hasn't fired yet, the DOM attribute may be stale. `tabState.get('running')` is always current.
- **FIX 4 — logger discipline in popup.js** (`popup/popup.js`): Replaced three `console.log` calls with `logger.log('popup', ...)` (CLAUDE.md rule 8 — every function must use `logger`): `surgeThreshold loaded`, `surgeEnabled saved`, `surgeThreshold saved`.
- **FIX 5 — clearSurgeHighlights null-parent guard** (`content/priceSurge.js`): `badge.parentNode.removeChild(badge)` wrapped in `if (badge.parentNode)`. A surge badge can be orphaned if Amazon React unmounts the card between the badge insertion and the next `clearSurgeHighlights` call. Null-parent `removeChild` throws a `NotFoundError` that silently kills the rest of the tick's badge-removal loop.
- **FIX 6 — log noise + hardening** (`content/sidebar.js`, `utils/constants.js`, `utils/storage.js`): `updateMemoryIndicator()` entry changed from `logger.log` to `logger.debug` (fires every 7s — too noisy at normal level). `isForbiddenElement()` now guards `el.nodeType !== 1 || typeof el.matches !== 'function'` before `.some()` — prevents TypeError when a text node or comment node is passed (e.g. from a MutationObserver record). `STORAGE_KEYS.SPEED`, `RUNNING`, `PRICE_HISTORY` annotated as legacy (moved to tabState; kept so Reset cleans old installs).

Test cases added: TC-POPUP-1 (auto-open OFF: no card opens), TC-SOUND-1 (popup preview matches in-page alert).

---

### 2026-07-03 — Bug-fix pass: detailOpener / loadParser / panelCloser / refreshManager + content pipeline (5 fixes)

Files changed: `content/content.js`, `content/detailOpener.js`, `content/loadParser.js`, `content/panelCloser.js`, `content/refreshManager.js`.

- **FIX 1 — highest-paying auto-open** (`content/content.js`, `content/detailOpener.js`): Added `sortByPayoutDesc(loads)` helper in `content.js` — returns a copy of the loads array sorted by numeric payout descending; unparseable payouts sort to end (`-Infinity`). `runDetectionPipeline` now sorts `result.newLoads` and `surgeLoads` via `sortByPayoutDesc` before passing to `openTopNewLoad` and `showInlinePanel`; `highlightNewLoads` continues to receive the original unordered array. `detailOpener.js` header comment updated to note that the caller passes payout-sorted loads. This is a behavior change at the existing neutral-zone click site (no new click site added).
- **FIX 2 — detach guard in deferred click** (`content/detailOpener.js`): Added `if (!document.contains(el))` check inside the `setTimeout(250)` callback, before computing `getBoundingClientRect()`. A React remount during the scroll-settle window detaches the card; a detached rect is (0,0) and `elementFromPoint` would click a viewport-corner element. Guard logs a warn and returns without clicking.
- **FIX 3 — nested duplicate card guard** (`content/loadParser.js`): `querySelectorAll` result converted to array; elements contained within another match in the same set are filtered out (`elB.contains(elA)` → drop `elA`). Prevents `.wo-card-header--highlighted` inner headers from producing a duplicate parse with `loadId=null`. Logs `logger.debug` with dropped count when > 0.
- **FIX 4 — panelCloser Strategy 2 less greedy** (`content/panelCloser.js`): Strategy 2 now collects ALL icon-only button candidates (no text, has SVG child) first, then prefers the candidate whose `getBoundingClientRect().top` falls within 80px of the sheet's top (most likely the close button). Falls back to first candidate if none qualify. Logs which strategy path and candidate index were used, plus total candidate count.
- **FIX 5 — stale "ONE allowed click" comments** (`content/refreshManager.js`, `content/detailOpener.js`): Two comment-only changes replacing "the ONE allowed .click() in this project/codebase" with "one of the three allowed Amazon-DOM click sites — see docs/SAFETY.md (canonical)". Comment in `detailOpener.js` header also updated (combined with FIX 1 header update).

Test cases added: TC-OPEN-1 (highest-paying card opened), TC-OPEN-2 (detach guard), TC-PARSE-1 (no null-loadId duplicates).

---

### 2026-07-03 — Bug-fix pass: inlinePanel.js (5 fixes)

File changed: `content/inlinePanel.js`. Docs updated: `docs/AMAZON_SELECTORS.md`, `docs/TEST_CASES.md`.

- **FIX 1 — waitForSheet stale-sheet guard** (`waitForSheet`, `sheetFingerprint`, `initManualToggle`): Added `sheetFingerprint(sheet)` helper (payout text + expander count + first stop label). Before calling `waitForSheet`, `initManualToggle` now captures `prevFingerprint` from the currently open sheet (if any). `waitForSheet(callback, prevFingerprint)` only declares the sheet ready when its fingerprint has changed from `prevFingerprint` — prevents reading the previous card's still-open sheet on the very first 50ms poll. Timeout fallback (1500ms) is unchanged; downstream handles stale reads. Auto-open path is not affected (calls `showInlinePanel` directly, does not go through `waitForSheet`).
- **FIX 2 — currentPanelCard desync between manual and auto paths** (`showInlinePanel`, `removeInlinePanel`, `initManualToggle`): Ownership of `currentPanelCard` moved into `showInlinePanel` (set on successful render) and `removeInlinePanel` (cleared). `initManualToggle` no longer touches the variable. Effect: auto-opened panels now register in `currentPanelCard`, so (a) clicking the auto-opened card once toggle-closes it, and (b) clicking an old card no longer removes a newer card's panel.
- **FIX 3 — global stop numbering breaks for segments with ≠2 stops** (`readSheetData`, `buildPanelElement`): Replaced per-segment formula `baseNum + sn` (broke for 3-stop segments) with a cumulative counter. Boundary stops (first stop of each non-first segment) get `counter - 1` (same as the previous segment's last stop number) without advancing the counter. Verified against documented example: 3×2-stop segments → 1,2/2,3/3,4 (identical output). `buildPanelElement` fallback changed from `stops.length > 1` to `stops.length > 0` for `destNum` — uses actual `stops[].num` whenever any stop exists.
- **FIX 4 — selector-drift alarm for hashed css-XXXX selectors** (`readSheetData`): Two `logger.warn('inlinePanel', 'SELECTOR DRIFT SUSPECTED …')` calls added: (1) when `.load-expander` count is 0 while the sheet exists; (2) when all parsed segments have 0 stops AND empty fromTo (all hashed selectors returned nothing). No behavior change — alarm only.
- **FIX 5 — flashActionSuccess writes string "null" as title** (`flashActionSuccess`): `btn.setAttribute('title', originalTitle)` now guarded: if `originalTitle === null` (button had no title attribute), calls `btn.removeAttribute('title')` instead to avoid writing the literal string `"null"`.

AMAZON_SELECTORS.md: new section "Detail sheet content (inlinePanel readSheetData) ⚠ FRAGILE" listing all hashed selectors with verification date and drift-alarm note.
Test cases added: TC-PANEL-4 (stale-sheet guard), TC-PANEL-5 (auto-open toggle-close + cross-card desync), TC-STOP-3 (3-stop segment numbering).

---

### 2026-07-03 — Bug-fix pass: core loop hardening (7 fixes)

Files changed: `utils/tabState.js`, `content/content.js`, `content/loadObserver.js`, `content/loadParser.js`. No new click sites, no FORBIDDEN_SELECTORS changes.

- **FIX 1 — tabState.set no-op on unchanged value** (`utils/tabState.js`): `set(key, value)` now returns early with a `logger.debug` line when `_state[key] === value` and `key !== 'priceHistory'`. Prevents redundant sessionStorage writes and subscriber notifications (e.g., repeated `running=false` calls no longer re-fire `stopOrchestrator`).
- **FIX 2 — startOrchestrator double-loop race** (`content/content.js`): Added module-level `orchLoopActive` flag. `startOrchestrator()` checks it first and returns with a warn if true; sets it to `true` before firing the first tick. `stopOrchestrator()` clears it. `scheduleNextTick()` bails if `!orchLoopActive`. Prevents a second `running=true` event during an in-flight tick from starting a parallel loop chain.
- **FIX 3 — extract shared detection pipeline** (`content/content.js` + `content/loadObserver.js`): The detect→highlight→sound→tabAlert→auto-open→inline-panel→auto-stop block was verbatim-duplicated. Extracted into `async function runDetectionPipeline(sourceTag)` in `content.js`. `orchestratorTick()` now calls `await runDetectionPipeline('tick')` after refresh+settle. `runObserverPipeline()` calls `await runDetectionPipeline('observer')`. `sourceTag` appears in all log lines so tick vs observer origin is distinguishable. Behavior identical to before.
- **FIX 4 — observer re-arms instead of dropping mutations during a tick** (`content/loadObserver.js`): When `runObserverPipeline` skips because `orchTickRunning` is true, it now re-arms a `setTimeout(runObserverPipeline, OBSERVE_DEBOUNCE_MS)` instead of silently dropping. Module-level `_rearmCount` caps at `MAX_REARMS = 3` consecutive re-arms; resets to 0 on successful run. Prevents DOM changes that arrive mid-tick from being lost.
- **FIX 5 — pruneLoadUnits guard on transient empty parse** (`content/loadParser.js`): `pruneLoadUnits` is now skipped when `results.length === 0`. A transient React remount during a filter change can briefly return 0 cards; the old code would wipe all LoadUnits including Phase 2 detail data. Logs `logger.debug` when skipped.
- **FIX 6 — isExtManagedNode catches inner container nodes** (`content/loadObserver.js`): Added `node.closest('#ext-inline-panel, #ext-sidebar')` check. Icon swaps (e.g., `flashActionSuccess` checkmark replacement) insert child nodes inside our panel without `ext-` IDs; they previously triggered useless observer pipeline passes.
- **FIX 7 — heap log noise** (`content/content.js`): `getHeapUsageRatio()` entry log changed from `logger.log` to `logger.debug`. It fires every 7 s from the sidebar memory-indicator poll, flooding logs at normal level.

Test cases added: TC-LOOP-1 (rapid toggle race), TC-STORE-1 (LoadUnit detail survives transient empty render).

---

### 2026-07-03 — Documentation synchronization pass (MD files only)

Full 9-item consistency pass across all project docs. No code files were changed.

- **Root `CLAUDE.md` deleted** — was the stale two-click-site version. `docs/CLAUDE.md` is now the single source of truth; "Правило завершення задачі" section appended to it.
- **`README.md`** — rewritten to reflect 2026-06-30 reality: 3+1 click sites, popup fully wired, Camera+Map wired, LoadUnit done, memory watchdog replaced by manual indicator.
- **`docs/SPEC.md`** — "20 sounds" → "25 sounds"; "Only two click types" → three Amazon-DOM click types with SAFETY.md reference for the extension-owned memory-indicator click.
- **`STATE.md`** — "Що далі" reduced from 4 contradictory items to 2 clean items (auto-filter restore PLANNED; `_element` audit CLOSED). "Блокери" reduced to 1: the two stale blockers (`_element` GC blocker and `clipboardWrite` not-added-yet blocker) removed.
- **`docs/BACKLOG.md`** — "Hide Similar Matches" marked ✅ DONE; storage key corrected from `'hideSimilar'` to `'hideSimilarMatches'`; `clipboardWrite` removed from Future manifest additions table (feature shipped 2026-06-30).
- **`docs/TEST_CASES.md`** — TC-TAB-5 rewritten (no auto-resume; loop starts paused, speed/threshold restore via tabState.init, dispatcher presses play manually); TC-OBS-5 rewritten (no `ext_resume_after_memory_reload` flag); TC-MEM-1 added (indicator polls while paused, click reloads, tooltip warns about filter loss).
- **`docs/AMAZON_SELECTORS.md`** — stale DIAG-logs paragraph replaced with one-line note: "DIAG logs removed 2026-06-18 after observer behavior was confirmed."
- **`STATE.md`** — "Оновлено" date updated to 2026-07-03; "Що в роботі" updated to reflect docs pass complete.

---

### 2026-06-30 — LoadUnit: unified per-load data model (Steps 1–3)

**New file: `utils/loadStore.js`**

In-memory per-tab load data store (`loadStore` IIFE). Keyed by `loadId` (UUID string).
In-memory only — cleared on any page reload (including dispatcher-triggered
ext-memory-indicator reload). NOT sessionStorage- or chrome.storage.local-backed.
Phase 2 (detail) data is only repopulated when the dispatcher reopens the detail sheet.

Functions exposed as `loadStore.*`:
- `mergeLoadUnit(loadId, patch)` — creates the entry if absent (with `firstSeenAt: Date.now()`),
  then applies the patch. `_element` is always excluded. `detail` and `searchContext` replace
  in full (no recursive merge). `payoutNum` is derived automatically from `patch.payout`.
- `getLoadUnit(loadId)` — returns the LoadUnit or null.
- `pruneLoadUnits(currentLoadIds)` — removes entries for loads no longer on the board; takes
  a `Set<string>` of currently visible loadIds.
- `getAllLoadUnits()` — returns the live internal map by reference; for debugging / future sync.
  Callers must not mutate returned objects.

`window.__EXT_DEBUG.getLoadUnits` exposed for console inspection (same pattern as `getLoads`).

**`manifest.json`** — `utils/loadStore.js` added to content_scripts js array immediately
after `utils/tabState.js` and before `vendor/html2canvas.min.js`, so it is defined before
any content/ module that calls it.

**`content/loadParser.js`** — inside `parseLoads()` for loop, after `results.push(load)`:
calls `loadStore.mergeLoadUnit(load.loadId, phase1Patch)` where `phase1Patch` contains all
ParsedCard fields except `_element`, `detail`, and `searchContext`. `boardStops` is the
renamed mapping of `load.stops` (abbreviated board-level strings, distinct from full
addresses in Phase 2 detail). After the for loop, calls
`loadStore.pruneLoadUnits(new Set(results.map(l => l.loadId).filter(Boolean)))`. Return
value and all external behavior of `parseLoads()` are unchanged — this is purely additive.

**`content/inlinePanel.js`** — in `showInlinePanel()`, after `readSheetData()` succeeds:
resolves `loadId` from `cardElement.querySelector('div[id]').id` (same selector
`parseOneCard` uses) and calls `loadStore.mergeLoadUnit(loadId, { detail: data })`. No
change to panel render path. `showInlinePanel()`'s return value and behavior are unchanged.

**`priceSurge.js`** — NOT touched. Step 4 (migrating `tabState.priceHistory` into
LoadUnit) is explicitly deferred per the approved plan.

**`searchContext`** — stays `null` in every LoadUnit; explicitly not parsed. Slot is
reserved in the schema for when new Amazon selector work is done.

---

### 2026-06-30 — Wire ext-action-map: open Google Maps directions for load route

**`content/inlinePanel.js`:**

- `openRouteInMaps(data)` — collects unique stops in global order by deduplicating on
  `stop.num` (boundary stops appear in both adjacent segments with the same num). Builds a
  Google Maps Directions URL: `origin` = first stop, `destination` = last stop, `waypoints`
  = all intermediate stops joined by `|` (omitted entirely when only 2 stops). Each stop is
  encoded as `stop.name + ' ' + stop.address` (address only if non-empty, else name alone)
  and passed through `encodeURIComponent`. Opens URL via `window.open(url, '_blank',
  'noopener,noreferrer')`. Logs entry + stop count; `logger.warn` when fewer than 2 unique
  stops found.

- `showInlinePanel()` — wires `[data-testid="ext-action-map"]` `addEventListener('click')`
  that calls `openRouteInMaps(data)`. Handler lives here (not in `buildActionBar`) because
  `data` from `readSheetData()` is only in scope in `showInlinePanel`. Extension-owned
  click — no new Amazon DOM interactions.

No new manifest permissions. No new dependencies.

---

### 2026-06-30 — Wire ext-action-camera: screenshot load card → copy PNG to clipboard

**New dependency:** `vendor/html2canvas.min.js` v1.4.1 (~194 KB, vendored local copy —
no CDN, no runtime fetch). Added to `manifest.json` content_scripts js array before all
`content/` scripts. `"clipboardWrite"` added to `manifest.json` permissions (per
BACKLOG.md note — this is the point where it was allowed to land).

**`content/inlinePanel.js`:**

- `flashActionSuccess(btn)` — swaps the camera button to a green checkmark SVG for 1.1 s
  then restores the original innerHTML and title. Pure visual confirmation, no storage.

- `captureCardToClipboard(cardElement, btn)` — calls `html2canvas(cardElement, { scale:
  devicePixelRatio, useCORS:true, allowTaint:false, backgroundColor:'#ffffff',
  logging:false })`, converts the resulting canvas to a PNG blob via `canvas.toBlob()`,
  writes it to the system clipboard via `navigator.clipboard.write([new ClipboardItem(…)])`.
  On success: calls `flashActionSuccess(btn)`. On any error (toBlob null, clipboard write
  rejected, html2canvas rejection): `logger.error()` with context — no uncaught throw, no
  silent no-op.

- `showInlinePanel()` — after `buildPanelElement()` returns, finds `[data-testid=
  "ext-action-camera"]` within the new panel and wires an `addEventListener('click', …)`
  that calls `captureCardToClipboard(cardElement, cameraBtn)`. Handler lives here
  (not in `buildActionBar`) because `cardElement` is only in scope in `showInlinePanel`.
  Extension-owned click, not Amazon DOM — exempt from the 3-click-site rule; documented
  in-code comment.

The capture targets the `cardElement` (div.load-card / div.load-card__selected) only —
the inline panel is a sibling, not a child, so it is never included in the screenshot.
The click on the button is the required user gesture for clipboard write.

---

### 2026-06-30 — Card Action Bar: icon row rendered in inline panel (no functionality yet)

Added a thin icon bar at the bottom of every expanded inline panel (single and
multi-segment). Render-only — no click handlers. Three buttons:

- `ext-action-camera` — camera icon (screenshot placeholder)
- `ext-action-map` — map-pin icon (route map placeholder)
- `ext-action-post` — document+plus icon (create post placeholder)

**`content/inlinePanel.js`:**
- CSS: `.ext-action-bar` (flex row, `border-top`, light grey background) and
  `.ext-action-btn` (28×28, no border, hover tint) added to `injectPanelStyle()`.
- `buildActionBar()` — new function (logger.log at entry); builds the bar and three
  `<button>` elements with inline stroke SVG icons (16×16, static markup, no page data;
  `innerHTML` used only for the static SVG string). Each button has `data-testid`,
  `aria-label`, `title`.
- `buildPanelElement()` — `panel.appendChild(buildActionBar())` added before `return`.

---

### 2026-06-30 — Diagnostic: _element DOM-node retention in knownLoadIds (no code change)

**Finding: non-issue — backlog item closed.**

`knownLoadIds` in `loadDetector.js` is a `Set<string>` (UUID strings only). Every write
is `knownLoadIds.add(load.loadId)` — the string ID, never the full load object or its
`_element`. Load objects with `_element` live only as local variables within each tick
(`validLoads` / `newLoads` in `detectNewLoads()`; `result.newLoads` in
`orchestratorTick()` and the `loadObserver` callback) and go out of scope when the tick
resolves. No detached-DOM-node retention occurs via this path.

Secondary observation: the Set grows unboundedly (IDs added but never evicted), but at
~36 bytes per UUID the accumulation is negligible.

No code change. No DIAG logging added.

---

### 2026-06-30 — Process change: remove mandatory plan-and-wait for routine work (CLAUDE.md)

**Not a code change.** Updated the Communication section in both `CLAUDE.md` and
`docs/CLAUDE.md`:

- **Removed** blanket rules "Before work — short plan, wait for approval" and "Stop after
  each stage, wait for approval".
- **Added** rule 1: routine changes (wiring a UI control, fixing a documented bug,
  applying a fully-specified prompt) proceed directly — report after, not before.
- **Added** rule 2: plan-first + wait for approval is still required for (a) anything
  touching FORBIDDEN_SELECTORS or adding any new `.click()` site (Amazon DOM or
  extension-owned), and (b) prompts that explicitly say "report plan before coding".
- Kept unchanged: bug-reproduction rule, "broke something → say so immediately", all
  "After ANY change" documentation rules, "Before ANY change" read rules.

---

### 2026-06-30 — Wire popup-reset button (Reset to Defaults)

**What:** wired the previously inert `popup-reset` button. Click immediately clears every
extension-managed key from `chrome.storage.local` (all 15 keys in `STORAGE_KEYS`,
including dead legacy keys SPEED/RUNNING/PRICE_HISTORY — harmless no-op for those since
they're no longer written there) and resets all popup UI controls to documented defaults.
No confirm dialog. `tabState` (sessionStorage, per-tab) is intentionally left untouched.

**Restyled:** changed from a prominent full-width green-bordered button to a small, muted
text link (`color:#aaa`, `font-size:11px`, underlined) positioned bottom-left via a new
`.popup-footer` flex wrapper. Becomes slightly darker on hover (`color:#666`). Low
visibility matches its infrequent-use intent.

**Bug fixed (discovered during implementation):** the existing `chrome.storage.onChanged`
listener in `popup.js` assigned `changes[KEY].newValue` directly for `volumeSlider`,
`soundSelect`, and `surgeThreshold`. On a `remove()` call, `newValue` is `undefined` —
this would stomp the reset handler's correct default values, leaving those fields blank.
Fixed: all three assignments now fall back to the documented default when `newValue` is
`undefined` (`70`, `'default'`, `50` respectively).

**Script includes added to popup.html:** `utils/constants.js`, `utils/logger.js`,
`utils/storage.js` (in manifest order, before `popup.js`) — provides `STORAGE_KEYS` for
the exhaustive key list, and `logger` per CLAUDE.md rule 8. `logger.log()` added at the
`DOMContentLoaded` entry point and at reset handler entry + completion.

- **`popup/popup.html`**: 3 script includes; `popup-reset` wrapped in `.popup-footer` div.
- **`popup/popup.css`**: `.popup-reset` restyled as text link; `.popup-footer` added.
- **`popup/popup.js`**: `resetBtn` wired; 3 onChanged lines hardened; `logger.log()` at
  `DOMContentLoaded` entry.

---

### 2026-06-30 — Replace automatic memory-watchdog reload with manual dispatcher-controlled indicator

**Why:** the automatic memory watchdog (`shouldReloadForMemory()`, content.js) called
`location.reload()` on its own once heap usage crossed 500MB/70%. Amazon Relay's search
filters (Origin, Radius, Payout min, Equipment) live only in React state, not the URL, so
the auto-reload silently wiped them with no warning — restoring them would require
simulating clicks on Amazon's own filter controls, which is out of scope per SAFETY.md.
Decision: remove the automatic trigger; let the dispatcher decide when to reload.

**content/content.js:**
- Removed `shouldReloadForMemory()`, `MEMORY_RELOAD_RATIO`, `MEMORY_RELOAD_MIN_BYTES`, the
  auto-reload block in `orchestratorTick()`, and the `ext_resume_after_memory_reload`
  sessionStorage resume-flag (no longer needed — there's no automatic reload to resume
  from, and the dispatcher chose not to auto-resume after a manual reload either).
- Added `getHeapUsageRatio()` — returns `{ usedBytes, limitBytes, ratio }` or `null` if
  `performance.memory` is unavailable. Pure read, no side effects, callable from
  sidebar.js independent of the orchestrator loop's running state.

**content/sidebar.js:**
- New `ext-memory-indicator` (small color-interpolated dot, green ≤40% → amber ~62.5% →
  red ≥85% of heap limit; stops tunable via `MEMORY_INDICATOR_LOW/MID/HIGH` constants).
  Polled every `MEMORY_POLL_MS` (7000ms) via `setInterval`, independent of `tabState.running`
  so it stays live while paused. Click or Enter/Space → `location.reload()` directly —
  dispatcher-initiated only, no automatic trigger anywhere in the extension. Per dispatcher
  decision, the loop does NOT auto-resume after this manual reload.
- New `ext-memory-info` icon — hover (desktop) and tap/focus (touch + keyboard) reveal a
  `textContent`-only tooltip (`ext-memory-tooltip`) explaining the reload and that the
  dispatcher will need to re-enter search filters afterward.

**docs/SAFETY.md:** documented `ext-memory-indicator` as an extension-owned click (our own
UI, not Amazon DOM) in a new "Extension-owned click" section — explicitly NOT added to the
"three click sites" list, since that rule governs Amazon DOM only.

**Out of scope (unchanged):** auto-restoring Amazon's filters after reload — tracked in
BACKLOG.md as a future feature, not started.

- **`content/content.js`**: removed auto-reload watchdog; added `getHeapUsageRatio()`.
- **`content/sidebar.js`**: added `ext-memory-indicator` + `ext-memory-info`.
- **`docs/SAFETY.md`**: documented the new extension-owned click site.

---

### 2026-06-18 — Style left-side stop numbers in segment header rows as blue circles

**Root cause:** `titleSpan` (`.ext-seg-title`, leftmost 40 px column) rendered its origin stop# as plain bold black text. The destination stop# (added in the previous step as a `.ext-stop-num` circle inside `destEl`) was already styled correctly. The two sides were visually mismatched.

**Fix:** three changes, all in `inlinePanel.js`:
1. **CSS `.ext-seg-header .ext-seg-title`** — replaced the plain-text rules (`font-weight:bold;color:#232f3e;text-align:center;padding:0 4px`) with `display:flex;align-items:center;justify-content:center;padding:0`. The span now acts as a flex centering wrapper for the circle inside it.
2. **CSS `.ext-seg-title .ext-stop-num`** — new one-rule override: `margin-right:0`. Cancels the `margin-right:8px` that `.ext-stop-num` normally uses when it precedes text (nothing follows the circle here).
3. **JS `buildPanelElement()`** — replaced `titleSpan.textContent = originNum` with a child `.ext-stop-num` span: same element type, same class, same construction pattern as the destination circle.

Result: both the origin (left column) and destination (inside route cell) now show identical dark-blue circles with white digits. No new CSS values introduced — all values (`#185FA5`, `18px`, `border-radius:50%`, `#fff`, `11px`) come directly from the existing `.ext-stop-num` rule.

- **`content/inlinePanel.js`**: CSS block + `buildPanelElement()`.

---

### 2026-06-18 — Fix global stop numbers in segment header rows

**Root cause:** `titleSpan` in the segment row header used `String(i + 1)` (a loop counter semantically tied to segment position, not global stop order). It happened to equal the origin stop# by coincidence but was not derived from the route data. More importantly, the destination stop had NO number shown in the header row at all — only the code name.

**Fix:** two changes in `buildPanelElement()` (multi-segment branch):
1. `titleSpan.textContent`: now derived from `segment.stops[0].num` (the origin global stop# assigned by `readSheetData()`'s post-processing loop). Falls back to `String(i + 1)` if segment has no parsed stops.
2. `destEl`: instead of `destEl.textContent = destText`, an `.ext-stop-num` circle (same style as the stop-detail table circles) is appended first, containing `segment.stops[last].num`, followed by the destination code text node. Falls back to `String(i + 2)`.

Result for a 3-stop load (2 segments):
- Row 0: `[1]` title | KILN → `[2]` DCM5
- Row 1: `[2]` title | DCM5 → `[3]` CMH1 (shared stop DCM5 = global 2 in both rows)

- **`content/inlinePanel.js`**: `buildPanelElement()` — `titleSpan` derivation + `destEl` circle.

---

### 2026-06-18 — Fix global stop numbers in inline panel stop-detail table

**Root cause:** `parseStopBlock()` always returned `num: ''` (hardcoded empty string). `buildSegmentTable()` gates the `.ext-stop-num` circle span on `if (stop.num)` — since `num` was never assigned, no stop-number circles appeared in the expanded stop table.

**Fix:** added a post-processing loop in `readSheetData()` (after all segments are built, before the route calculation and return). For segment index `N` (0-based), stop at position `k` within the segment receives global number `N+1+k`. This produces the correct shared-stop numbering:
- Segment 0: stops [1, 2]
- Segment 1: stops [2, 3]  ← 2 is shared
- Segment 2: stops [3, 4]  ← 3 is shared

No rendering changes — `buildSegmentTable()` already rendered circles when `stop.num` was truthy.

- **`content/inlinePanel.js`**: added global-stop-number assignment loop in `readSheetData()`.

---

### 2026-06-18 — Remove temporary DIAG logs from loadObserver.js

- **`content/loadObserver.js`**: removed all temporary DIAG logs added during debugging:
  the DOM-snapshot block in `startLoadObserver()`, the per-callback mutation detail log
  (`DIAG callback: fired` with batchSize / target / added / removed class dump), the
  `var m0` binding that existed only to feed those logs. Replaced DIAG-prefixed callback
  status logs with standard operational logs (`mutation: ext-managed change only — ignored`,
  `mutation: not running — ignored`, `mutation: external change — debouncing`).
  All CLAUDE.md-required logs retained: `logger.log()` at each function entry,
  `logger.error()` in catches, standard pipeline result logs.
  File header updated to remove "DIAG logs remain" note.

---

### 2026-06-18 — Fix MutationObserver (attempt 3): broad hasExternalChange filter + _pipelineRunning guard

**Root cause of attempt 2 failure:** `hasLoadCardChange()` matched mutations by specific class names (`'load-card'`, `'load-list'`). Amazon wraps the load-list in React container nodes whose roots have dynamic/hashed class names (`css-xyz`). Those wrapper nodes ARE added to the DOM when the filter changes — but they don't carry `load-card` or `load-list` classes. All four cases in `hasLoadCardChange()` missed them. The observer WAS firing; the filter killed the debounce before it started.

**Fix:** replaced `hasLoadCardChange()` with `hasExternalChange()` — fires for ANY childList mutation that doesn't involve ext-managed nodes, regardless of class names. Amazon's non-load updates are mostly `characterData` or `attribute` mutations which `childList` doesn't observe; the rare non-load `childList` mutation triggers a pipeline pass that calls `detectNewLoads()`, finds `newCount=0`, and exits silently.

Added `_pipelineRunning` boolean guard: prevents two concurrent observer pipeline runs (e.g., Amazon's sheet DOM mutations trigger the observer while the first pipeline is still inside `await sleep(800)`). `orchTickRunning` guard unchanged.

- **`content/loadObserver.js`**: `hasLoadCardChange()` removed; `hasExternalChange()` added (broad, class-name-agnostic). `_pipelineRunning` flag added to `runObserverPipeline()` with `try/finally` reset. DIAG logs unchanged — every callback still logs target/class/running state.

---

### 2026-06-18 — Fix MutationObserver: anchor on document.body to survive container replacement

**Root cause diagnosed:** the observer was bound to `div.load-list` with `subtree:false`. Amazon is a React SPA — changing a filter unmounts the entire `div.load-list` and mounts a fresh one. The old node is detached; an observer on a detached node never fires. The observer went deaf the moment the container was replaced.

**Fix:** anchor on `document.body` (never replaced), observe `{ childList: true, subtree: true }`. Filter every callback with `hasLoadCardChange()` so only load-card or load-list node changes trigger the debounce — Amazon's unrelated UI updates (countdown, breadcrumbs, etc.) are immediately discarded.

- **`content/loadObserver.js`** — complete rewrite:
  - `isExtManagedNode()` updated: now also catches id/data-testid starting with `'ext-'` (covers surge badges with `data-testid="ext-surge-badge"`).
  - `hasLoadCardChange(mutations)` — new filter function. Four cases covered: (1) `mutation.target` is a `div.load-list`; (2) added `div.load-card/load-card__selected`; (3) added/removed `div.load-list` (container replaced); (4) added wrapper contains `div.load-card` or `div.load-list` inside (intermediate parent replaced). Each hit logs a `DIAG` line.
  - `startLoadObserver()` — now observes `document.body` with `{ childList:true, subtree:true }`. Removed `findLoadListContainer()` (no longer needed as the anchor).
  - Observer callback logs every invocation (`DIAG callback: fired`) with batch size, first mutation's target/added/removed class for diagnosis. Logs are intentionally left in until user confirms the fix works.

- **`docs/AMAZON_SELECTORS.md`**: MutationObserver anchor section updated — anchor is now `document.body` with explanation of why `div.load-list` was volatile.

---

### 2026-06-18 — Instant new-load detection via MutationObserver

New `content/loadObserver.js` — supplements the timer tick with a `MutationObserver` on `div.load-list` that runs the existing detection pipeline the moment Amazon's DOM changes (new loads pushed by Amazon, or filter-param change reloads the list). No new `.click()` sites — reuses `openTopNewLoad` neutral-zone click exactly as the tick does.

- **`content/loadObserver.js`** *(new)*:
  - `findLoadListContainer()` → `document.querySelector('div.load-list')` (first, same as parser).
  - `isExtManagedNode(node)` — filters our own `div#ext-inline-panel` insertions (direct child of load-list) and non-element nodes from triggering the pipeline. Prevents infinite observer loop.
  - `runObserverPipeline()` — async. Runs `parseLoads → detectNewLoads → checkPriceSurge → highlightNewLoads → playAlert → flashTabAlert → openTopNewLoad → showInlinePanel → tabState.set('running', false)`. Guards against concurrent tick via `orchTickRunning` flag. Idempotent: `detectNewLoads` diffs against `knownLoadIds`; back-to-back observer+tick pass finds `newCount=0` on the second run — no duplicate alert, no timer reset needed.
  - `startLoadObserver()` — creates observer with `{ childList: true, subtree: false }` and calls `.observe()` on the container. No-op if already active.
  - `stopLoadObserver()` — disconnects observer, cancels pending debounce. Safe to call when inactive.
  - Debounce: 200ms — coalesces burst mutations from filter changes.

- **`content/content.js`**: in `tabState.subscribe('running', fn)` — added `startLoadObserver()` on `val=true`, `stopLoadObserver()` on `val=false`. Added `stopLoadObserver()` before `location.reload()` in memory watchdog path.

- **`manifest.json`**: added `"content/loadObserver.js"` between `"content/panelCloser.js"` and `"content/content.js"`.

---

### 2026-06-18 — Remove filter-panel auto-close; left filter stays open by default

All code that attempted to auto-close the left filter popover on loop start has been removed. Three separate strategies were tried (close-button search, toggle-button click, Escape dispatch + retry) and none worked reliably against Amazon's DOM. The left filter panel is now intentionally left alone — it stays open or closed however the user left it. The right detail-panel auto-close is unchanged and working.

- **`content/panelCloser.js`**: removed `diagFilterPanel()`, `isFilterPanelOpen()`, `findFilterCloseButton()`, `tryCloseFilterPanel()`. `closePanelsForStart()` now contains only the detail-panel close block. File header updated.
- **`utils/constants.js`**: removed `CLOSE_FILTER_PANEL` from `ALLOWED_CLICK_INTENTS`. Comment updated from "Exactly four" to "Exactly three".
- **`docs/SAFETY.md`**: removed Click 3 (filter panel close) section including the Escape fallback note. Click 4 (detail panel) renumbered to Click 3. Counts updated from four to three throughout.
- **`docs/CLAUDE.md`**: rule 4 and safety rule 4 — removed filter-panel close from allowed click list. "Four" → "three".
- **`docs/AMAZON_SELECTORS.md`**: removed entire Filter panel close section. Detail panel close reference updated from Click 4 → Click 3.
- **`docs/UI_ELEMENTS.md`**: panelCloser description updated — filter panel mention removed.

---

### 2026-06-18 — FIX 1 (attempt 3): filter panel close — full diagnostic + retry + Escape fallback

**Why previous attempts failed:** the selector `button[aria-label="Filter"][aria-expanded="true"]` is case-sensitive. Amazon may use a different label casing or may not put `aria-expanded` on the button at all. Also `closePanelsForStart()` fires synchronously on loop start — the popover may not be present in the DOM yet at t=0.

- **`content/panelCloser.js`** — complete rewrite of filter close logic:
  - `diagFilterPanel()` — new diagnostic helper. Logs every `[aria-expanded="true"]` element (tag, aria-label, aria-controls, aria-haspopup, role, id, text) and every `button[aria-label]` containing "filter" (ariaLabel, ariaExpanded, ariaControls, ariaHaspopup, ariaPressed, visible). Runs on every `findFilterCloseButton()` call.
  - `isFilterPanelOpen()` — new helper. Returns true if a filter toggle button with `aria-expanded="true"` is present (case-insensitive), or any `button[aria-expanded="true"]` with "filter" in label, or a visible "Filter…" heading is in the DOM.
  - `findFilterCloseButton()` — enhanced. Strategy 0 now case-insensitive (`button[aria-label="Filter" i][aria-expanded="true"]`). Strategy 0b added: any `button[aria-expanded="true"]` whose aria-label includes "filter" (case-insensitive). Strategies 1–3 unchanged as fallbacks. Calls `diagFilterPanel()` on entry for live logging.
  - `tryCloseFilterPanel(attemptsLeft)` — new retry wrapper. Polls up to 3 times at 250ms intervals (total 750ms, within the 1200ms settle window). If all retries fail and `isFilterPanelOpen()` returns true, dispatches `Escape` keydown on `document.body` as last resort (Amazon React popovers close on Escape).
  - `closePanelsForStart()` — now calls `tryCloseFilterPanel(3)` instead of inline filter close. Detail panel close unchanged.

- **`docs/AMAZON_SELECTORS.md`**: Filter panel close section updated — Strategy 0 now case-insensitive; Strategy 0b added; retry + Escape fallback documented.
- **`docs/SAFETY.md`**: Added note to Click 3 — Escape keydown fallback (not a `.click()`, cannot trigger booking; only dispatched when popover appears open but no button was found after 3 retries).

---

### 2026-06-18 — FIX 1 (attempt 2): filter panel close; FIX 2: manual card open stops loop

- **`content/panelCloser.js`** — FIX 1: `findFilterCloseButton()` — prepended Strategy 0 (primary): `document.querySelector('button[aria-label="Filter"][aria-expanded="true"]')`. The filter control is a toggle button, not a panel with a separate X button — clicking it when `aria-expanded="true"` closes the popover. Existing strategies 1–3 retained as fallbacks for layout changes. No new whitelist entry needed; CLOSE_FILTER_PANEL already covers this.
- **`content/inlinePanel.js`** — FIX 2: `initManualToggle()` — inside the `waitForSheet` callback (toggle-on path), added `tabState.set('running', false)` in its own try/catch before `showInlinePanel`. Fires only when a user manually clicks a load card; the extension's own auto-open path (`openTopNewLoad` → `content.js`) already stops via the same call there. Per-tab only (tabState, not storage.local).
- **`docs/AMAZON_SELECTORS.md`**: updated Filter panel close section — Strategy 0 added as the primary approach (`button[aria-label="Filter"][aria-expanded="true"]`); existing strategies renumbered 1–3.

---

### 2026-06-18 — Auto-close filter + detail panels on loop start

- **`content/panelCloser.js`** *(new)*: `closePanelsForStart()` closes the filter popover and the load-detail sheet (`#selected-work-sheet`) once per loop start by clicking their own close controls. Two new allowed click sites (authorized in SAFETY.md). `findFilterCloseButton()`: 3-strategy search — (1) button with aria-label containing "filter"+"close", (2) panel identified by "Filter…" heading ancestor → button with aria-label "close", (3) icon-only button fallback. `findDetailCloseButton()`: (1) `button[aria-label*="close" i]` inside `#selected-work-sheet`, (2) icon-only button fallback. Every path guarded by `isForbiddenElement()`. Each close wrapped in its own try/catch; logs and skips silently when a panel is not open.
- **`content/content.js`**: added `closePanelsForStart()` call in the `tabState.subscribe('running', fn)` subscriber, before `startOrchestrator()`. Fires once per loop start; does not re-fire while loop is running.
- **`manifest.json`**: `"content/panelCloser.js"` inserted before `"content/content.js"`.
- **`utils/constants.js`**: added `CLOSE_FILTER_PANEL` and `CLOSE_DETAIL_PANEL` to `ALLOWED_CLICK_INTENTS`. Updated comment from "Only these two" to "Exactly four".
- **`docs/SAFETY.md`**: binding boundary updated to four click sites; Click 3 (filter close) and Click 4 (detail close) sections added with rationale, safety argument, gates, and intent constants. Audit checklist updated to name all four sites.
- **`docs/CLAUDE.md`**: rule 4 updated to name all four allowed click sites explicitly.
- **`docs/AMAZON_SELECTORS.md`**: Filter panel close and Detail panel close sections added with selector strategies and re-verify warnings.

---

### 2026-06-18 — Sidebar: remove surge threshold field

- **`content/sidebar.js`**: removed `sidebar-surge-label` span (`↑$`), `sidebar-surge-threshold` number input, the `surgeInput.value` seed line, and the `saveSurgeThreshold` function + its two `addEventListener` calls. Removed the three CSS rule blocks for those two testids (including the webkit spin-button suppression). `tabState.surgeThreshold` logic in `utils/tabState.js` and `content/priceSurge.js` is unchanged — per-tab threshold still works, just no longer exposed in the sidebar UI.

---

### 2026-06-18 — Per-tab state isolation: running, speed, surge threshold, price history

**Problem:** `chrome.storage.local` is shared across all tabs. Auto-stopping in Tab A also stopped Tab B; speed and surge-threshold changes in one tab affected every other tab.

**Solution:** four fields moved out of `chrome.storage.local` into an in-memory + sessionStorage per-tab store (`tabState`). Global settings (nightMode, sounds, tag filters, `surgeEnabled`) are unchanged.

- **`utils/tabState.js`** *(new)*: IIFE exposing `{ init, get, set, subscribe }`. `_state` holds `{ running, refreshIntervalMs, surgeThreshold, priceHistory }`. `set()` updates `_state`, mirrors refreshIntervalMs / surgeThreshold / priceHistory to sessionStorage (running stays memory-only), then calls all synchronous subscribers for that key. `init()` is async: reads sessionStorage for speed/history/threshold; if no threshold in sessionStorage, reads the popup global from `chrome.storage.local[surgeThreshold]` as the default for a new tab, then resolves.

- **`manifest.json`**: added `"utils/tabState.js"` immediately after `"utils/storage.js"` so it is available to all content scripts.

- **`content/sidebar.js`**: removed `async` (no more awaits). Removed both `await storage.get(SPEED/RUNNING, ...)` init reads — replaced with synchronous `tabState.get(...)`. `toggleRunning()` now calls `tabState.set('running', nowRunning)` instead of `storage.set(RUNNING, ...)`; removed direct `reflectRunning()` call (subscriber fires it synchronously). Slider writes `tabState.set('refreshIntervalMs', sec * 1000)` instead of `storage.set(SPEED, ...)`. Removed entire `chrome.storage.onChanged.addListener` block (both RUNNING and SPEED branches). Added `tabState.subscribe('running', reflectRunning)` so the pill flips when the orchestrator auto-stops. Added surge-threshold inline field: `<input type="number" data-testid="sidebar-surge-threshold">`, seeded from `tabState.get('surgeThreshold')`, writes `tabState.set('surgeThreshold', n)` on input/change.

- **`content/content.js`**: removed `chrome.storage.onChanged.addListener` for RUNNING; replaced with `tabState.subscribe('running', fn)` (registered synchronously before the async IIFE). `scheduleNextTick()` made synchronous: reads `tabState.get('running')` and `tabState.get('refreshIntervalMs')` directly. Both auto-stop blocks (new-load + surge) changed from `await storage.set(RUNNING, false); stopOrchestrator()` to `tabState.set('running', false)` — the subscriber calls `stopOrchestrator()` synchronously. Wrapped page-load init in `(async function(){ await tabState.init(); buildSidebar(); initManualToggle(); ... })()` so tabState is seeded before sidebar reads it. Memory-reload resume path changed from `storage.set(RUNNING, true)` to `tabState.set('running', true)`.

- **`content/priceSurge.js`**: removed `SURGE_THRESHOLD` and `PRICE_HISTORY` from `chrome.storage.local.get()` — now only reads `SURGE_ENABLED` from storage. Reads threshold via `tabState.get('surgeThreshold')`. Reads history via `tabState.get('priceHistory')`. Writes rebuilt history via `tabState.set('priceHistory', newHistory)` (synchronous, no await). Resets history on disable via `tabState.set('priceHistory', {})`.

---

### 2026-06-17 — Memory-pressure watchdog: rare auto-reload + resume

- **`content/content.js`**:
  - Added constants: `MEMORY_RELOAD_RATIO = 0.7`, `MEMORY_RELOAD_MIN_BYTES = 500 MB`. Both must be exceeded before a reload is considered (prevents reloads in healthy short sessions).
  - Added `shouldReloadForMemory()`: reads `performance.memory` (guards `undefined` → `false`), logs heap stats (usedMB / limitMB / ratio), returns `true` only when `used >= 500 MB && ratio >= 0.7`. `logger.log` on entry, `logger.error` in catch.
  - At the end of `orchestratorTick` try-block, after the new-load / surge branches: when `result.newCount === 0 && surgeLoads.length === 0` (loop still running, nothing for dispatcher) and `shouldReloadForMemory()` is true → sets `sessionStorage['ext_resume_after_memory_reload'] = '1'` and calls `location.reload()`.
  - Page-load init replaced: reads `sessionStorage['ext_resume_after_memory_reload']`; if `'1'` → removes key, logs, calls `storage.set(RUNNING, true)` (existing `onChanged` listener fires `startOrchestrator()`). Otherwise → existing `RUNNING=false` forced, manual Start required as before.

---

### 2026-06-17 — Price Surge: remove diagnostic code (feature confirmed working)

- **`content/priceSurge.js`**: removed all temporary debug code — per-tick `SURGE-DBG tick:` log, per-load `SURGE-DBG id=...` log, and `window.__EXT_DEBUG.simulateSurge` test hook. No behavior change; surge logic, highlight, badge, sound, and auto-stop remain intact. `grep SURGE-DBG|simulateSurge` → 0 matches.

---

### 2026-06-17 — Price Surge: diagnostics + simulateSurge test hook

- **`content/priceSurge.js`** (debug only — no behavior change):
  - **Part A — per-tick debug log** (marked `// DEBUG: remove later`): logs once per call to `checkPriceSurge` after reading storage — `SURGE-DBG tick: enabled=<bool> historySize=<n> loadsThisTick=<n>`. Shows whether the engine runs, whether surge is enabled, and whether history is populated.
  - **Per-load debug log** widened: previously only logged when `payout !== prev`; now logs for **every load where `prev !== undefined`** regardless of change — `SURGE-DBG id=<loadId> prev=<prev> now=<payout> delta=<delta> thr=<threshold> trig=<bool>`. Makes stable-price ticks visible for confirming loadId stability across refreshes.
  - **Part B — `window.__EXT_DEBUG.simulateSurge(loadId, amount)`**: console-callable test hook. Reads current loads via `parseLoads()`, parses payout, sets `PRICE_HISTORY[loadId] = payout - amount` so the **next orchestrator tick** sees delta = +amount and must trigger if amount >= threshold. Logs loadId, fakePrev, currentPayout, and expected delta to console. Default: first visible load, amount = $100.

---

### 2026-06-16 — Inline panel: center route arrow between equal-width origin/dest halves

- **`content/inlinePanel.js`** (CSS + builder, no behavior change):
  - `.ext-seg-route` grid changed from `150px 1fr` (fixed-left) to `1fr auto 1fr` (symmetric). Arrow column is `auto` (glyph width only), so origin and destination halves are always equal regardless of text length. Arrow stays centered at all times.
  - `.ext-route-origin`: `text-align` changed from `right` to `center`; `min-width:0` kept so the cell can shrink. Text wraps within its half.
  - `.ext-route-dest`: added `overflow-wrap:break-word; word-break:break-word; min-width:0; text-align:center` — previously had none of these.
  - `.ext-route-right` wrapper removed from both CSS and JS. Arrow and destination are now direct children of `.ext-seg-route`, sitting in columns 2 and 3 of the 3-column grid.
  - Arrow margin tightened from `0 0.45em` to `0 0.35em` (less gap against the tighter `auto` column).

---

### 2026-06-16 — Tag filters: add "Booked before" toggle + fix leftover space (display:none + wrapper collapse)

- **`utils/storage.js`**: added `HIDE_PAST_BOOK: 'hidePastBook'`.
- **`content/filterTags.js`**:
  - Added 4th tag state: `pastBook`. Queries `[id="PAST_BOOK"]` via `querySelectorAll`, never `getElementById`.
  - **Bug fix — leftover space**: changed all tag hiding from `visibility:hidden` to `display:none`, so the tag element's space collapses entirely.
  - **Wrapper collapse**: new `recomputeWrappers()` — after hiding individual tags, iterates every `.wo-tag` wrapper. If ALL its known tag children (`[id="PROMOTED"]`, `[id="STARTING_SOON"]`, `[id="TRAILER_READY"]`, `[id="PAST_BOOK"]`) are `display:none`, the wrapper itself is set to `display:none` to remove the remaining gap. Restores `display:''` when any child becomes visible again. Wrappers with no known tag children are never touched.
  - Observer and `anyOn` guard updated to include `pastBook`.
- **`popup/popup.html`**: 4th toggle "Booked before" added to `.popup-tag-block`; `id="popup-hide-past-book"`, `data-testid="popup-hide-past-book"`. No inline handlers.
- **`popup/popup.css`**: `.popup-tag-block` gap reduced from `6px` to `4px` to accommodate 4 items cleanly.
- **`popup/popup.js`**: `KEY_HIDE_PAST_BOOK`, element ref, load-on-open, `addEventListener('change')`, `onChanged` entry — wired identically to the other three tag toggles.

---

### 2026-06-16 — Price Surge: price-only highlight + auto-stop + open details

- **`content/priceSurge.js`**:
  - Removed full-card `.ext-surge-load` yellow background. Now highlights only the payout element: `.ext-surge-price` (green text + subtle green tint on `.wo-total_payout`). Injects a sibling badge span (`'↑ +$' + Math.round(delta)`) via `textContent` with `data-testid="ext-surge-badge"`. `clearSurgeHighlights()` removes both the class and every `[data-testid="ext-surge-badge"]` badge so stale badges never accumulate.
  - `checkPriceSurge` now **returns** an array of surge load objects (the full load, including `_element`). `priceSurge.js` itself never calls `.click()`.
- **`content/content.js`**: captures `surgeLoads = await checkPriceSurge(loads)`. Added `else if (surgeLoads.length > 0)` branch that mirrors the new-load auto-stop pattern exactly: `openTopNewLoad(surgeLoads)` (existing neutral-zone click — no new `.click()` sites), `sleep(800)`, `showInlinePanel`, then `storage.set(RUNNING, false)` + `stopOrchestrator()`. Surge branch only fires when `result.newCount === 0` (new loads take priority).

---

### 2026-06-16 — Price Surge Alert: implement + fix persistence bug

- **Root cause of persistence bug:** `popup-surge` and `popup-surge-threshold` were completely absent from `popup.js` — no key constants, no element refs, not in the storage read, no write handlers, not in the `onChanged` listener. The HTML `value="50"` attribute was the only source of truth, causing the field to revert on every popup open.
- **`utils/storage.js`**: added `SURGE_ENABLED: 'surgeEnabled'`, `SURGE_THRESHOLD: 'surgeThreshold'`, `PRICE_HISTORY: 'priceHistory'` to `STORAGE_KEYS`.
- **`popup/popup.js`**: wired `popup-surge` and `popup-surge-threshold` following the same pattern as all other controls — key constants, element refs, included in `chrome.storage.local.get([...])`, load callback, write handlers (`addEventListener` on `'input'`+`'change'` for threshold, `'change'` for toggle; invalid/NaN values silently skipped without overwriting), `onChanged` live-sync. `console.log` on both load and save paths for console verification.
- **`content/priceSurge.js`** (new): `checkPriceSurge(loads)` — single storage read per tick (`SURGE_ENABLED`, `SURGE_THRESHOLD`, `PRICE_HISTORY`); if disabled clears highlights and resets `PRICE_HISTORY` to `{}`; builds `newHistory` from scratch each tick (auto-purges gone loads); triggers only on payout increases `>= threshold`; applies `.ext-surge-load` (amber `rgb(255,214,102)`) via `classList`; calls `playAlert()` on new surge cards. DEBUG log on any payout change (any direction) for verification. Style injection idempotent by `<style id="ext-surge-style">`.
- **`content/content.js`**: `await checkPriceSurge(loads)` inserted after `detectNewLoads(loads)`, before the new-load branch — runs every tick unconditionally.
- **`manifest.json`**: `content/priceSurge.js` added after `soundAlert.js` (needs `playAlert`) and before `content.js`.

---

### 2026-06-16 — Inline panel: right-align origin in route cell

- **`content/inlinePanel.js`** (CSS only): added `text-align:right` to `.ext-route-origin`. Origin text is now flush against the arrow on its right edge; arrows stay in the same vertical column; outer columns unaffected.

---

### 2026-06-16 — Inline panel: remove status/action badges + align route arrows

- **`content/inlinePanel.js`** (CSS + builder, no data/logic change):
  - **Status column** (Loaded/Empty): removed `.ext-badge-loaded` / `.ext-badge-empty` pill rules. Now plain text directly on `.ext-seg-status` span. Green `#1a5c38` / bold for Loaded (`.ext-seg-loaded`), muted `#878787` for Empty (`.ext-seg-empty`).
  - **Action column** (Drop/Live/Preloaded): removed `.ext-badge-action` pill rule. Plain text directly on `.ext-seg-action` span, muted `#565959`.
  - **Route arrows aligned**: `.ext-seg-route` converted from inline-flow to inner 2-column grid `150px 1fr`. Origin occupies the fixed 150px column; a new `.ext-route-right` wrapper spans `[arrow + destination]` in the remaining `1fr` column. All arrows now stack in a single vertical column regardless of origin length. `min-width:0` on both sub-columns keeps the outer grid unaffected.

---

### 2026-06-16 — Inline panel: visual redesign of segment-header rows

- **`content/inlinePanel.js`** (CSS + builder, no data/logic change):
  - **Grid**: `40px minmax(0,3fr) 1.4fr 1fr 1fr 32px` (wider route column, fuller width). Vertical padding increased to 10px for better readability.
  - **Route connector**: `fromToSpan` is now three separate DOM nodes — `.ext-route-origin` + `.ext-route-arrow` + `.ext-route-dest` — all set via `textContent`, no innerHTML. Origin and destination render in a monospace stack (`ui-monospace,"SF Mono",Menlo,Consolas,monospace` 11px) for readable IDs. Arrow `→` is bold, 1.15em, `#1a5c38` accent — clearly visible separator between endpoints.
  - **Distance·time**: `.ext-seg-dist` — muted `#878787`, 11px, centered, so it recedes behind the route.
  - **Badges**: "Loaded" → `.ext-badge-loaded` (filled `#1a5c38` green pill); "Empty" → `.ext-badge-empty` (muted outline pill); Drop/Live/Preloaded → `.ext-badge-action` (neutral `#e8edf0` grey pill). Each badge sits inside a `.ext-seg-action` / `.ext-seg-status` wrapper cell for independent CSS targeting and `text-align:center`.
  - Action span always emitted (grid slot kept); badge only rendered when `loadType` is non-empty.

---

### 2026-06-16 — Inline panel: fix segment-header column alignment

- **`content/inlinePanel.js`** (CSS + builder only, no data/logic change):
  - `.ext-seg-header`: changed from `display:flex; justify-content:space-between` to `display:grid; grid-template-columns:32px minmax(0,2.2fr) 1.2fr 1fr 1fr 28px` — 6 fixed columns matching the 6 rendered fields (number / route / dist·time / action / status / arrow). Column edges now align identically across all segment rows.
  - Added `.ext-seg-route{min-width:0; overflow-wrap:break-word; word-break:break-word}` — route text wraps inside column 2 instead of overflowing or truncating. Rows may be taller when route is long; column alignment is unaffected.
  - `.ext-seg-title` and `.ext-seg-arrow` gain `text-align:center` and tighter padding (`0 4px`) to match their fixed 32/28 px columns.
  - `buildPanelElement`: `loadTypeSpan` is now always emitted (empty string when absent) so all 6 grid columns are always present. Previously the span was conditional, which collapsed the grid and shifted later columns.

---

### 2026-06-15 — Step 3: Tag filters — hide badge only (not the card)

- **`content/filterTags.js`:** changed hiding strategy from `card.style.display = 'none'` to `tagEl.style.visibility = 'hidden'` on the tag element itself. Cards stay fully visible and clickable; only the purple badge is hidden. `recomputeTagHiding()` now queries each tag id directly (`[id="PROMOTED"]` etc.) and sets `visibility` per toggle state — no card-root traversal. Restores `visibility = ''` when toggled off.
- **`content/loadDetector.js`:** reverted the `offsetParent === null` exclusion added in the previous step — it was needed only while cards were `display:none`. All cards now participate in new-load detection normally.

---

### 2026-06-15 — Step 3: Hide tag filters (Promoted / Starting soon / Trailer ready)

- **`utils/storage.js`:** added `HIDE_PROMOTED: 'hidePromoted'`, `HIDE_STARTING_SOON: 'hideStartingSoon'`, `HIDE_TRAILER_READY: 'hideTrailerReady'` (all boolean, default false).
- **`content/filterTags.js`** (new): `recomputeTagHiding()` iterates all card roots (`div.load-card, div.load-card__selected, div.wo-card-header--highlighted`), checks each for `[id="PROMOTED"]` / `[id="STARTING_SOON"]` / `[id="TRAILER_READY"]` descendants, sets `card.style.display = 'none'` or `''`. Uses `querySelectorAll` (never `getElementById`) because Amazon duplicates these ids across cards. `MutationObserver` active only while ≥1 toggle is on; disconnects when all off. `applyTagHiding()` called on init (reads storage) and on `chrome.storage.onChanged`. No `.click()`, no innerHTML.
- **`content/loadDetector.js`:** `detectNewLoads()` filter now also excludes loads where `load._element.offsetParent === null` — hidden cards (display:none or ancestor hidden) are never detected as new, never highlighted, never trigger sound or auto-open.
- **`popup/popup.html`:** replaced single "Hide Promoted & Starting Soon" row with `.popup-tag-block` — three compact columns, each with a small label (`Promoted` / `Starting soon` / `Trailer ready`) and a small toggle (`toggle-switch--sm`). ids: `popup-hide-promoted`, `popup-hide-starting-soon`, `popup-hide-trailer-ready`.
- **`popup/popup.css`:** added `.popup-tag-block`, `.popup-tag-filter`, `.popup-tag-label`, `.toggle-switch--sm` (30×16 px variant with 10 px dot and 14 px translate).
- **`popup/popup.js`:** three new key vars; all three read on popup open, written on `change`, synced via `chrome.storage.onChanged`. Updated WIRED/NOT-WIRED comment.
- **`manifest.json`:** `content/filterTags.js` inserted after `content/filterSimilar.js`.

---

### 2026-06-15 — Step 3: Sound block — expanded to 25 sounds

- **`content/soundAlert.js`:** replaced 3-branch if-else with `SOUND_DEFS` dispatch table (25 entries). Added `freqEnd` support to `playSoundConfig`: if a tone descriptor has `freqEnd`, oscillator frequency ramps linearly from `freq` to `freqEnd` over the tone duration using `setValueAtTime` + `linearRampToValueAtTime`. `getSoundTones()` now delegates to `SOUND_DEFS[soundId] || SOUND_DEFS['default']`. New sounds: bell, deep, high, click, ding, sonar, low, blip, wood, double, notify, drop, triple, alarm, fanfare, sparkle, sweep_up, sweep_down, chord, dial, burst, error.
- **`popup/popup.html`:** `<select id="popup-sound-select">` expanded from 3 to 25 `<option>` elements.
- **`popup/popup.js`:** `popupGetSoundTones()` replaced with `POPUP_SOUND_DEFS` dispatch table (identical 25 configs). `previewSound()` updated to handle `freqEnd` the same way as `playSoundConfig`.

---

### 2026-06-11 — Step 3: Sound block wired (persistence + preview)

- **`utils/storage.js`:** removed `SOUND_MUTED: 'soundMuted'`; added `VOLUME: 'soundVolume'` (number 0–100, default 70) and `SOUND_ID: 'soundId'` (string, default `'default'`).
- **`content/soundAlert.js`:** refactored. `getSoundTones(soundId, startTime)` — pure function, returns tone descriptors for `'default'` / `'soft'` / `'sharp'`. `playSoundConfig(soundId, gainPeak)` — async, resumes AudioContext, schedules oscillators. `playAlert()` — reads `VOLUME` + `SOUND_ID` from storage; returns early if `VOLUME === 0`; scales gain as `VOLUME / 100`. No more `SOUND_MUTED`.
- **`popup/popup.html`:** wrapped `<select>` and new replay `<button>` in `.popup-sound-select-row` div. New element: `id="popup-sound-replay"`, `data-testid="popup-sound-replay"`, `aria-label="Preview sound"`.
- **`popup/popup.css`:** added `.popup-sound-select-row` (flex row) and `.popup-sound-replay` (28×28 px icon button, green on hover) styles.
- **`popup/popup.js`:** Sound block fully wired. On open: reads `soundVolume` + `soundId` from storage, sets slider and dropdown (defaults: 70 / `'default'`). Slider writes on `change` (released, not every `input`). Dropdown writes on `change` then plays preview. Replay button plays preview of current selection at current volume. `previewSound(soundId, volume)` — mirrors `soundAlert.js` configs exactly (same `getSoundTones` logic) using a popup-local `AudioContext`. Live sync via `chrome.storage.onChanged`.

---

### 2026-06-11 — Step 3: Tab Alert wired

- **`utils/storage.js`:** added `TAB_ALERT: 'tabAlert'` to `STORAGE_KEYS`.
- **`content/tabAlert.js`** (new): `flashTabAlert()` — async, reads `STORAGE_KEYS.TAB_ALERT`; if enabled, swaps favicon to an orange "!" canvas icon and blinks the document title with "🔔 " prefix at 750 ms intervals for 10 s total. `stopTabAlert()` restores title and favicon; called automatically on `visibilitychange` (user focuses tab) or after duration. Both functions exposed on `window.__EXT_DEBUG`. No `.click()` calls.
- **`manifest.json`:** `content/tabAlert.js` inserted after `content/soundAlert.js`, before `content/detailOpener.js`.
- **`content/content.js`:** `flashTabAlert()` called in `orchestratorTick()` after `playAlert()` when new loads are found (`result.newCount > 0` branch). Not awaited — fire-and-forget is fine since the blink runs on its own timer.
- **`popup/popup.js`:** Tab Alert toggle wired alongside Night Mode. Reads `tabAlert` on DOMContentLoaded, writes on `change`, synced live via `chrome.storage.onChanged`.

---

### 2026-06-11 — Step 3: Night Mode wired (clean implementation)

- **`utils/storage.js`:** added `NIGHT_MODE: 'nightMode'` to `STORAGE_KEYS`.
- **`content/nightMode.js`** (new): CSS-class-toggle approach — `ensureNightStyle()` injects `<style id="ext-night-mode-style">` once (idempotent); `applyNightMode(on)` toggles `html.ext-night` class. All dark rules are scoped to `html.ext-night`, so toggling off instantly reverts to Amazon's original styles. Header preserved via `header, [role="banner"], nav[role="navigation"]` forced back to `#1a5c38`. Own sidebar (`#ext-sidebar`) and inline panel (`#ext-inline-panel`) re-asserted to their original colours at high specificity. `initNightMode()` reads storage on load; `chrome.storage.onChanged` keeps it live. `window.__EXT_DEBUG.toggleNight` exposed for console testing. No `.click()` calls.
- **`manifest.json`:** `content/nightMode.js` inserted after `utils/storage.js`, before `content/refreshManager.js`.
- **`popup/popup.js`:** Night Mode toggle wired — reads `nightMode` on DOMContentLoaded, writes on `change`, stays live via `chrome.storage.onChanged`. All other controls remain unwired.

---

### 2026-06-11 — Night Mode wiring fully reverted

Night Mode went through four CSS iterations (per-selector overrides → root invert → invert + tweaks → direct color overrides) but all had live-site conflicts (Amazon top header colour, invert side-effects). Entire Night Mode wiring reverted to UI-BUILT state pending a clean reimplementation.

- **Deleted:** `content/nightMode.js`
- **`manifest.json`:** removed `content/nightMode.js` from `content_scripts.js` array
- **`utils/storage.js`:** removed `NIGHT_MODE: 'nightMode'` from `STORAGE_KEYS`
- **`popup/popup.js`:** restored to intentionally inert (no DOMContentLoaded, no storage access)
- **`docs/UI_ELEMENTS.md`:** `popup-night-mode` status reverted to NOT wired
- **`docs/BACKLOG.md`:** Night Mode reverted from DONE → UI-BUILT; note added on correct approach (direct color overrides, not invert())

---

### Session 2026-06-11 — Sidebar redesign + Popup redesign + Bug fixes

#### content/sidebar.js — play/pause + scanline
- Removed: old `ext-btn-toggle` text button (Start / Stop).
- Added: `ext-playpause` pill control (SVG play ↔ pause icons). Visual state driven entirely by `container[data-running]` attribute + CSS selectors — no JS toggling class names. Click calls `toggleRunning()` which writes `STORAGE_KEYS.RUNNING` to storage (single source of truth). Keyboard: Enter / Space.
- Added: `ext-scanline` div at bottom edge of bar. CSS-only animation (`extScan` keyframe) runs while `container[data-running="true"]`. Speed linked to refresh interval via CSS custom property `--ext-scan-dur` set by `applyScanSpeed(speedSec)` (formula: `speedSec * 0.7`, clamped 0.5s..4s). `prefers-reduced-motion` disables animation.
- Added: `applyScanSpeed()` helper called on slider input AND on `chrome.storage.onChanged` for `STORAGE_KEYS.SPEED` (popup or other source changes speed → scanline updates live).
- `chrome.storage.onChanged` listener now handles both `STORAGE_KEYS.RUNNING` and `STORAGE_KEYS.SPEED`.

#### popup/popup.html + popup/popup.css + popup/popup.js — full redesign (UI only)
- Removed from popup: "Active" toggle, refresh-speed slider, "Loads visible" / "Last refresh" status fields. Run/speed control lives only in the sidebar now.
- New popup layout — two sections: **Display & Alerts** and **Load Board Filters**.
- Display & Alerts controls (UI built, NOT wired): Night Mode toggle, Tab Alert toggle, Sound block (volume slider + sound selector dropdown), Price Surge Alert toggle + threshold number input.
- Load Board Filters controls (UI built, NOT wired): Hide Promoted & Starting Soon toggle, Hide Similar Matches toggle.
- Footer: Reset to defaults button (NOT wired).
- `popup.js` is intentionally inert — no DOMContentLoaded handler, no storage access. Placeholder for Step 3 wiring.

#### content/detailOpener.js — scroll-before-click fix
- Bug: `elementFromPoint` returned null for new loads scrolled below the viewport (y > window.innerHeight). Fix: call `el.scrollIntoView({ block: 'center' })` (try/catch) after all three gates pass, then defer the point-resolve + click to `setTimeout(..., 250)`. Return true optimistically after scheduling. All safety checks (null, isForbiddenElement, el.contains fallback) run inside the timeout with the post-scroll rect.

#### content/detailOpener.js — earlier fix (same session)
- Replaced `dispatchRealisticClick` synthetic event sequence with `document.elementFromPoint` approach. Point biased left (30% width, 50% height) to avoid the Book button. Two additional safety gates on resolved target.

#### content/inlinePanel.js — multiple fixes and features
- `readSheetData` returns `{ header, segments }` (segmented model). Segments parsed from `.load-expander` blocks.
- Equipment text: regex `/\d+'\s*Trailer/` on normalized `.css-1cbogyo` text. Load type (Live/Drop/Preloaded): regex `Trailer\s+(Live|Drop|Preloaded)/i` on same block. Both set in one pass.
- Per-segment stop dedup by `arrival|departure` time key (fresh `seen` object per segment). Stops with missing times always kept.
- `buildPanelElement`: single-segment loads render the table directly (no accordion); two+ segments get collapsible grey headers (collapsed by default).
- Added `waitForSheet(callback)`: polls every 50ms (max 1500ms) until `#selected-work-sheet` contains `.load-expander`, then fires callback. Used by `initManualToggle` instead of fixed 800ms timeout.
- Added `initManualToggle()`: document-level click listener (bubbling); clicks on `.load-card` / `.load-card__selected` trigger `waitForSheet` → `showInlinePanel`. Clicking the same card again removes the panel (toggle off). `isForbiddenElement` guard on `ev.target`. Double-init guard via `window.__extManualToggleInit`. NOT auto-called from this file.
- `currentPanelCard` module-level variable tracks which card owns the current panel.
- CSS: `table-layout:fixed`, column widths 40/20/20/20%, `word-break:break-word`. Scanline gap removed (`margin: 0 0 12px 0`). Segment header uses `justify-content:space-between`, no `margin-left:auto` on arrow.

#### content/content.js — wiring + orchestrator fixes
- `initManualToggle()` called after `buildSidebar()` on page load.
- `startOrchestrator()` now fires `orchestratorTick().then(scheduleNextTick)` — first tick is immediate on Start, no initial delay.
- After new loads found: `openTopNewLoad` return value captured; if `autoOpen && opened`, `sleep(800)` then `showInlinePanel(result.newLoads[0]._element)` in try/catch. Auto-stop (storage.set RUNNING false + stopOrchestrator) happens AFTER the panel renders.

#### content/loadParser.js — green-highlight cards fix
- `parseLoads()` selector updated to: `div.load-card, div.load-card__selected, div.wo-card-header--highlighted`. Amazon highlights new loads with `wo-card-header--highlighted` before the user clicks them; without this fix they were invisible to the detector.

#### content/highlighter.js — match Amazon's highlight color
- `.ext-new-load` rule changed to `background-color: rgb(182, 227, 255) !important` (matches Amazon's own new-load highlight). Outline/box-shadow removed.

#### manifest.json
- `content/inlinePanel.js` added to `js` array after `detailOpener.js`, before `sidebar.js`.

---

### Stage 13 fix — 2026-06-09
- Updated: content/detailOpener.js — replaced el.click() with dispatchRealisticClick(el); fires pointerdown→mousedown→mouseup→click via dispatchEvent so Amazon's React handler sees a full synthetic event sequence; all 3 gates + FORBIDDEN guard unchanged; return values unchanged

### Stage 13.5 fix — 2026-06-04
- Updated: content/content.js — page load now forces RUNNING=false (no auto-start); orchestratorTick new-loads branch now calls storage.set(RUNNING,false)+stopOrchestrator() after highlight/sound/open, flipping sidebar+popup toggle back via onChanged

### Stage 13.5 — 2026-06-04
- Updated: utils/storage.js — added STORAGE_KEYS.AUTO_OPEN = 'autoOpenTopNew'
- Updated: content/content.js — added orchestrator: orchTimer/orchTickRunning state, sleep(), orchestratorTick() (refresh → settle → parse → diff → highlight+sound+open if new), scheduleNextTick() (reads RUNNING+SPEED, self-reschedules via setTimeout), startOrchestrator()/stopOrchestrator(); chrome.storage.onChanged listener wires RUNNING toggle; restores running state on page load

### Stage 13 — 2026-06-04
- Added: content/detailOpener.js — openTopNewLoad(newLoads): 4-gate safety check (existence, isForbiddenElement, DOM membership), NEUTRAL_ZONE intent log, ONE el.click() on card body; __EXT_DEBUG.openTopNew exposed; NOT wired to refresh loop
- Updated: manifest.json — content/detailOpener.js added after soundAlert.js, before sidebar.js
- Updated: docs/SAFETY.md — "Sole .click()" section updated to record both click sites (refreshNow + openTopNewLoad)

### Stage 12 — 2026-06-04
- Added: content/soundAlert.js — lazy AudioContext; playAlert(): checks SOUND_MUTED, resumes suspended ctx, plays 880Hz+1100Hz two-tone beep via OscillatorNode+GainNode, try/catch; __EXT_DEBUG.playAlert exposed; NO clicks, NOT wired to detector
- Updated: utils/storage.js — added STORAGE_KEYS.SOUND_MUTED = 'soundMuted'
- Updated: manifest.json — content/soundAlert.js added after highlighter.js, before sidebar.js

### Stage 11.5 fix — 2026-06-04
- Updated: content/loadParser.js — parseLoads() now scopes to first div.load-list only (main results); "Similar matches" second list ignored; parseOneCard() unchanged

### Stage 11 — 2026-06-04
- Added: content/highlighter.js — injectHighlightStyle() (once, guarded by id); highlightNewLoads(newLoads): adds .ext-new-load class; clearHighlights(): removes from all matching elements; __EXT_DEBUG.highlightNew + clearHighlights exposed; NO clicks, NOT wired to refresh loop
- Updated: manifest.json — content/highlighter.js added after loadDetector.js, before sidebar.js

### Stage 10 — 2026-06-04
- Added: content/loadDetector.js — detectNewLoads(loads): Set-based diff, first-run seeding (returns empty on first call), skips null loadIds; resetKnownLoads(); __EXT_DEBUG.detectNewLoads + resetKnownLoads exposed; NO clicks, NO highlighting, NOT wired to refresh loop
- Updated: manifest.json — content/loadDetector.js added after loadParser.js, before sidebar.js

### Stage 9 fix — 2026-06-04
- Updated: utils/storage.js — added STORAGE_KEYS.RUNNING = 'isRunning'
- Updated: content/sidebar.js — restores running state from storage on init; toggle click persists STORAGE_KEYS.RUNNING; sidebar and popup now fully in sync via storage
- Updated: popup/popup.js — comment updated confirming KEY_RUNNING literal matches STORAGE_KEYS.RUNNING; no logic change needed

### Stage 9 — 2026-06-04
- Added: popup/popup.html — CSP-safe (no inline scripts), links popup.css + popup.js
- Added: popup/popup.css — 320px wide, green toggle switch, slider, status section
- Added: popup/popup.js — reads/writes chrome.storage.local directly (isolated context); toggle writes isRunning; slider writes refreshSpeedSeconds; chrome.storage.onChanged keeps UI live; NO .click(), NO parsing
- Updated: manifest.json — action.default_popup set to popup/popup.html
- Updated: docs/UI_ELEMENTS.md — replaced placeholder popup entries with actual Stage 9 elements

### Stage 8 — 2026-06-02
- Added: content/loadParser.js — parseOneCard() + parseLoads(); Layout A only (div.load-card / load-card__selected); parses loadId, payout, pricePerMile, distance, duration, stops, equipment, trailerLetter, loadingType, deadhead, tag, specialServices, _element; per-card try/catch; __EXT_DEBUG.getLoads exposed; NO .click(), NO auto-run
- Updated: manifest.json — content/loadParser.js added after refreshManager.js, before sidebar.js
- Updated: docs/AMAZON_SELECTORS.md — expanded Load card (Layout A) section with all verified field selectors and strategies

### Stage 8-pre — 2026-06-02
- Updated: utils/constants.js — added '#book-btn-row' to FORBIDDEN_SELECTORS (Layout B/Contracts Book button; out of scope but guarded); isForbiddenElement() logic unchanged; array now has 3 selectors
- Updated: docs/AMAZON_SELECTORS.md — added #book-btn-row to Booking FORBIDDEN section with out-of-scope note; marked Layout B/Contracts as intentionally ignored with explanation
- Updated: docs/SPEC.md — added "MVP scope: Load Board only" section; clarified feature #2 as Layout A only; added Contracts/Block/Layout B to Non-goals

### Stage 7 — 2026-06-02
- Updated: content/refreshManager.js — added refreshNow(): isForbiddenElement guard + tagName==='BUTTON' check + the ONE button.click() in the codebase; exposed __EXT_DEBUG.refreshNow; findRefreshButton and refreshDryRun unchanged
- Updated: docs/SAFETY.md — recorded refreshNow() as sole .click() call site, listed all 3 required gates; updated audit checklist

### Stage 6 — 2026-06-02
- Added: content/refreshManager.js — findRefreshButton() (2-strategy fallback chain, NO .click()); refreshDryRun() (finds, logs, isForbiddenElement check, NO .click()); __EXT_DEBUG.refreshDryRun exposed for manual console testing only
- Updated: manifest.json — content/refreshManager.js added after storage.js, before sidebar.js
- Updated: docs/AMAZON_SELECTORS.md — replaced Refresh button TODO with verified fallback chain strategy (strategy 1: "Next Refresh" text → parent → button; strategy 2: SVG path d-attribute → .closest('button'))

### Stage 5 — 2026-06-02
- Added: utils/storage.js — storage object with async get/set/remove/getAll wrapping chrome.storage.local; STORAGE_KEYS.SPEED constant defined here
- Updated: manifest.json — utils/storage.js added after logger.js, before sidebar.js
- Updated: content/sidebar.js — buildSidebar made async; restores saved speed from storage before attaching listeners; slider input persists STORAGE_KEYS.SPEED

### Stage 4 — 2026-06-02
- Updated: content/sidebar.js — added ext-btn-toggle (Start/Stop, data-running state), ext-slider-speed (0.5–8s step 0.5 default 2), ext-slider-value (one decimal); removed ext-status and ext-count; addEventListener only, no Amazon clicks, no setInterval
- Updated: docs/UI_ELEMENTS.md — registered Stage 4 elements; removed ext-status and ext-count

### Stage 3 — 2026-06-02
- Added: content/sidebar.js — buildSidebar() injects fixed top-center bar with title; guard against double injection; CSS via style.textContent (static only)
- Updated: manifest.json — added content/sidebar.js before content/content.js in js array
- Updated: content/content.js — removed self-test lines; calls buildSidebar() on load
- Updated: docs/UI_ELEMENTS.md — added ext-sidebar and ext-sidebar-title entries

### Stage 2 — 2026-06-02
- Updated: utils/constants.js — added ALLOWED_CLICK_INTENTS (REFRESH, NEUTRAL_ZONE), EXT_NAME, EXT_VERSION, DEBUG_LEVEL; FORBIDDEN_SELECTORS + isForbiddenElement untouched
- Updated: utils/logger.js — debug() now gated by DEBUG_LEVEL constant
- Updated: content/content.js — 4-level self-test (log/warn/error/debug) on load

### Stage 1 — 2026-06-02
- Added: manifest.json (MV3, host_permissions relay.amazon.com only)
- Added: utils/constants.js (FORBIDDEN_SELECTORS, isForbiddenElement)
- Added: utils/logger.js (logger.log, logger.warn, logger.error, logger.debug)
- Added: content/content.js (skeleton — logs "extension loaded" only)

### Stage 0 — 2026-06-02
- Added: documentation foundation (docs/ + README)
