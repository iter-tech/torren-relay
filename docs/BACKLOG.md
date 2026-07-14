# Feature Backlog

Status key: **UI-BUILT** = HTML/CSS exists in popup, logic not wired | **PLANNED** = not yet started | **PARTIAL** = some code exists

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
