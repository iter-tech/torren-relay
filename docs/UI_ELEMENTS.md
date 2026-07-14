# UI Elements Registry

Every UI element MUST have a unique data-testid.
When reporting a bug, use the testid name.

## LoadUnit data store (utils/loadStore.js — 2026-06-30)

No new extension UI elements. `loadStore.js` is a pure data-layer module — it maintains
an in-memory map of `LoadUnit` objects keyed by `loadId`. No DOM elements are injected.
No Amazon DOM is read or written. No new `.click()` sites. This is a data-modeling
refactor only; all visual rendering continues to live in its original modules.

---

## Load observer (content/loadObserver.js — 2026-06-18)

No new extension UI elements. `loadObserver.js` is a background behavioral module — it adds a `MutationObserver` on `div.load-list` and triggers the existing detection pipeline when Amazon's DOM changes. No visible elements are injected; all highlighting/badge rendering stays in their original modules.

---

## Panel closer (content/panelCloser.js — 2026-06-18)

No new extension UI elements. This feature clicks Amazon's own close control — it is Amazon's element, not ours, so it has no `data-testid` from the extension. Behavior: when the loop starts, the load-detail sheet is closed via its own close button if it is currently open. The left filter panel is intentionally left alone. Controlled by `closePanelsForStart()`, called once per loop start from the `tabState 'running'` subscriber in `content.js`.

---

## Sidebar (current state — 2026-06-18)

| testid | Type | Function |
|--------|------|----------|
| ext-sidebar | div | Bar container (fixed, top-center). Carries `data-running` attr ("true"/"false") which drives all CSS visual state — play/pause icon swap, scanline animation. |
| ext-sidebar-title | span | "Amazon Relay Helper" title text. |
| ext-playpause | span[role=button] | Play ↔ pause pill. SVG icons swap via `#ext-sidebar[data-running] .ext-pp__play/pause` CSS. Click / Enter / Space calls `toggleRunning()` → writes `tabState.running` (per-tab, not storage.local). |
| ext-slider-speed | range | Refresh speed 0.5–8 s, step 0.5, default 2. Writes `tabState.refreshIntervalMs` (per-tab). Also calls `applyScanSpeed()` on input. |
| ext-slider-value | span | Live display of slider value, e.g. "2.0s". |
| ext-memory-indicator | span[role=button] | Small dot, `role="button"`, color-interpolated (green→amber→red) from `getHeapUsageRatio()` (content.js), polled every 7s via `setInterval` — independent of the running loop, so it updates while paused. Click or Enter/Space → `location.reload()` directly (dispatcher-initiated only; no automatic trigger). `title`/`aria-label` show live %. Added 2026-06-30, replacing the automatic memory-watchdog reload. |
| ext-memory-info | span | Small "i" icon next to the indicator. Hover (mouseenter/leave), focus/blur, and click/tap all toggle a custom tooltip child (`ext-memory-tooltip`) — explains the reload, that filters will need re-entry, via `textContent`. Added 2026-06-30. |
| ext-memory-tooltip | div | Child of `ext-memory-info`. Positioned absolute under the info icon, shown via `.ext-tooltip-visible` class. Text set with `textContent` only. |
| (ext-scanline) | div.ext-scanline | No testid — purely decorative. CSS-only animation along bottom edge when running. Speed tied to `--ext-scan-dur` CSS var. |

**Removed sidebar elements:** `sidebar-surge-label`, `sidebar-surge-threshold` (removed 2026-06-18 — per-tab threshold still live in tabState/priceSurge, just no longer surfaced in sidebar UI).

**Removed elements (no longer in DOM):** `ext-btn-toggle`, `ext-status`, `ext-count`.

## Popup (current state — UI built, logic NOT wired)

| testid | Type | Function |
|--------|------|----------|
| popup-version | span | Extension version display. |
| popup-night-mode | checkbox | Night Mode toggle — dark theme over Relay site. **Wired** → writes `nightMode` to `chrome.storage.local`; `content/nightMode.js` toggles `html.ext-night` class live. |
| popup-tab-alert | checkbox | Tab Alert toggle — flash tab title/favicon on new load. **Wired** → writes `tabAlert` to `chrome.storage.local`; `content/tabAlert.js` flashes title (🔔 prefix) and favicon (orange "!" icon) for 10 s, clears on tab focus. |
| popup-auto-open | checkbox | Auto-Open Top Load toggle. **Wired (2026-07-03)** → writes `autoOpenTopNew` to `chrome.storage.local`. **True-default** (`checked = data[KEY] !== false`). When ON (default): `content.js runDetectionPipeline` calls `openTopNewLoad` + `showInlinePanel` for the highest-paying new load. When OFF: highlights, sound, tab alert, and auto-stop still fire — only the card-open and inline-panel steps are skipped. Reset restores to ON. |
| popup-volume | range | Sound volume 0–100. **Wired** → writes `soundVolume` to `chrome.storage.local` on slider release (`change`). Read back on popup open (default 70). `content/soundAlert.js` scales oscillator gain as `volume / 100`; `volume === 0` → silent. |
| popup-sound-select | select | Sound selector dropdown (25 options). **Wired** → writes `soundId` to storage on `change`, then plays an immediate preview. Read back on popup open (default `'default'`). Sounds: default, soft, sharp, bell, deep, high, click, ding, sonar, low, blip, wood, double, notify, drop, triple, alarm, fanfare, sparkle, sweep_up, sweep_down, chord, dial, burst, error. |
| popup-sound-replay | button | Icon-only replay button (▶) next to the dropdown. **Wired** → plays a preview of the currently selected sound at the current volume on click. |
| popup-surge | checkbox | Price Surge Alert toggle. **Wired** → writes `surgeEnabled` to storage; `content/priceSurge.js` enables per-tick payout comparison. |
| popup-surge-threshold | number | $ threshold for surge alert. **Wired** → writes `surgeThreshold` (number, default 50); saved on `input`+`change`; invalid/NaN values ignored without overwriting. |
| popup-hide-promoted | checkbox | Hide the Promoted badge on load cards. **Wired** → writes `hidePromoted`; `filterTags.js` sets `display:none` on `[id="PROMOTED"]`; collapses `.wo-tag` wrapper if all children hidden. Card stays fully visible. |
| popup-hide-starting-soon | checkbox | Hide the Starting soon badge. **Wired** → writes `hideStartingSoon`; `filterTags.js` sets `display:none` on `[id="STARTING_SOON"]`; collapses wrapper if all children hidden. |
| popup-hide-trailer-ready | checkbox | Hide the Trailer ready badge. **Wired** → writes `hideTrailerReady`; `filterTags.js` sets `display:none` on `[id="TRAILER_READY"]`. |
| popup-hide-past-book | checkbox | Hide the "Booked before" badge. **Wired** → writes `hidePastBook`; `filterTags.js` sets `display:none` on `[id="PAST_BOOK"]`. |
| popup-hide-similar | checkbox | Hide Similar Matches block. **Wired** → writes `hideSimilarMatches`. |
| popup-reset | button | Reset all settings to defaults. **Wired** (2026-06-30). Restyled as a muted text link (`color:#aaa`, `font-size:11px`, underlined, no background/border), bottom-left via `.popup-footer` flex wrapper. Click → `chrome.storage.local.remove(Object.values(STORAGE_KEYS))` then resets all popup controls to documented defaults inline. No confirm dialog. `tabState`/sessionStorage untouched. |

**Removed popup elements:** `popup-toggle` (run/stop — now sidebar-only), `popup-slider-speed`, `popup-slider-value`, `popup-load-count`, `popup-last-refresh`.

## Inline Panel (content/inlinePanel.js)

Injected below the clicked load card. No data-testid (dynamic, managed by `PANEL_ID = 'ext-inline-panel'`).

| Class | Type | Function |
|-------|------|----------|
| ext-inline-panel | div | Outer wrapper. `id="ext-inline-panel"`. |
| ext-seg-header | div | Collapsible segment header (multi-segment loads only). `display:grid` with 6 fixed columns: `40px minmax(0,3fr) 1.4fr 1fr 1fr 32px` — number / route / dist·time / action / status / arrow. Always 6 child spans. Toggles `ext-open` on self + paired body. |
| (ext-route-origin) | span | Origin code, column 1 (`1fr`) of `.ext-seg-route` 3-column grid. Monospace, centered, wraps within its half. `min-width:0`. |
| (ext-route-arrow) | span | Route connector `→`, column 2 (`auto`) — glyph width only, always centered. Bold, 1.15em, `#1a5c38`. |
| (ext-route-dest) | span | Destination code, column 3 (`1fr`). Monospace, centered, wraps within its half. `min-width:0`. Contains an `.ext-stop-num` circle (destination global stop#) prepended before the code text. |
| (ext-seg-loaded) | class on `.ext-seg-status` | "Loaded" — plain text, `#1a5c38` green, font-weight 500. No pill. |
| (ext-seg-empty) | class on `.ext-seg-status` | "Empty" — plain text, muted `#878787`. No pill. |
| (ext-seg-action) | span | Action text (Drop/Live/Preloaded) — plain text, muted `#565959`. No pill. |
| ext-seg-body | div | Segment table container. `display:none` until `ext-open`. |
| ext-inline-panel__table | table | Stop rows. `table-layout:fixed`, columns 40/20/20/20%. |
| ext-stop-num | span | Blue circle with stop number. `display:inline-flex`, 18×18 px, `#185FA5` background, white text, `border-radius:50%`, 11px. Used in three places: (1) stop-detail table rows; (2) inside `.ext-route-dest` in segment header rows (destination global stop#); (3) inside `.ext-seg-title` in segment header rows (origin global stop#, `margin-right:0` override applied). |
| ext-stop-addr | div | Grey address line under stop name. |
| ext-dot-loaded | span | Solid black dot = loaded trailer. |
| ext-dot-empty | span | Outlined dot = empty trailer. |

## Price Surge highlight (content/priceSurge.js)

Injected on the payout element of a surge-triggered card. Never on the whole card.

| testid / class | Type | Function |
|----------------|------|----------|
| (ext-surge-price) | class on `.wo-total_payout` | Green text + subtle green tint on the payout amount when a surge triggers. Removed by `clearSurgeHighlights()` each tick before re-applying. |
| ext-surge-badge | span | Sibling of `.wo-total_payout`. Shows `↑ +$NN` (delta rounded) via `textContent`. `data-testid="ext-surge-badge"`. Removed by `clearSurgeHighlights()`. Never uses innerHTML. |

Single-segment loads: table rendered directly, no accordion wrapper.

## PAT Modal (content/patModal.js — rework 2026-07-07)

Extension-owned dialog. Opens when dispatcher clicks `ext-action-post`. Pre-fills from `loadStore.getLoadUnit(loadId)`. Cities auto-resolved via API (not user-editable). No `.click()` on Amazon DOM. All text via `textContent`. Width: 580px. Equipment gate: "53' Trailer" only — other equipment shows an unsupported notice.

### Kept testids (same name across both implementations)
| testid | Type | Function |
|--------|------|----------|
| pat-modal-overlay | div | Full-screen backdrop. Click outside modal → close. |
| pat-modal | div[role=dialog] | Modal shell. `aria-modal=true`. Escape key → close. |
| pat-modal-title | span | "Are you sure you want to create the following order?" heading. |
| pat-modal-close | button | × close button in header. |

### New testids (ext-pat-* prefix)
| testid | Type | Function |
|--------|------|----------|
| ext-pat-origin | div | Origin city name (static text). Resolved from `boardStops[0]` via `resolvePATCity()`. Shows "CITY, ST" from API result. `.resolving` class while API call is in flight. |
| ext-pat-origin-radius | select | Origin radius in miles. Options: 5/10/15/20/25/50/75/100. Default 25. |
| ext-pat-dest | div | Destination city name (static text). Resolved from `boardStops[last]`. Same display format and loading state. |
| ext-pat-dest-radius | select | Destination radius in miles. Options: 25/50/75/100/150/200/250. Default 50. |
| ext-pat-start | span[role=button] | Start-time stepper display. Format: "MM/DD HH:mm TZ". Click → reveals datetime-local input. |
| ext-pat-start-minus | button | Step start time back 15 min. |
| ext-pat-start-plus | button | Step start time forward 15 min. |
| ext-pat-end | span[role=button] | End-time stepper display. Same pattern as start. |
| ext-pat-end-minus | button | Step end time back 15 min. |
| ext-pat-end-plus | button | Step end time forward 15 min. |
| ext-pat-stops | div | Stop count (static text from `detail.header.stopsCount`). |
| ext-pat-min-miles | input[type=number] | Minimum distance filter. Default: board distance − 25. |
| ext-pat-max-miles | input[type=number] | Maximum distance filter. Default: board distance + 25. |
| ext-pat-driver | div | Driver type (static text "Solo"). |
| ext-pat-permile | input[type=number] | Offer per mile ($/mi). Linked to payout via board distance. |
| ext-pat-payout | input[type=number] | Total offer payout ($). Default = `payoutNum + 5000` (silent markup). Linked to per-mile. |
| ext-pat-stem | select | Stem time (minimum pickup buffer). Options: 5/15/30/45/60/90/120/150/180/210/240/480/720/1440 min. Default 30 min. |
| ext-pat-exclude-swing | checkbox | "Exclude Swing Door loads". Default checked → `excludeSpecialServices:["SWING_DOOR"]`. |
| ext-pat-summary | div | Summary line: "Equipment: X (Provided) Loading Type: Y". Static text. |
| ext-pat-cancel | button | Dismiss modal without submitting. |
| ext-pat-confirm | button | Validate → `buildPatPayload()` → `submitOrder()`. Disabled until cities resolve. Disabled + "Submitting…" during POST. Green "Post created ✓" on success; modal fades and closes after 2.5s. Re-enables on error. |
| ext-pat-status | div | Status line (resolving / error / success messages). |

## Card Action Bar (content/inlinePanel.js — 2026-06-30, post wired 2026-07-06)

Thin icon row at the very bottom of every expanded inline panel (single and multi-segment).
Rendered via `buildActionBar()`, appended last inside `buildPanelElement()`. All three buttons wired as of 2026-07-06.

| testid | Type | Function |
|--------|------|----------|
| ext-action-bar | div | Bar container. `border-top`, `background:var(--ext-n100)`, `display:flex`. Rendered. |
| ext-action-camera | button.ext-action-btn | Camera icon (screenshot). `aria-label="Screenshot"`. **Wired (2026-06-30)**: click → `captureCardToClipboard()` → html2canvas renders the load card → PNG blob → `navigator.clipboard.write()`. On success: icon flashes green checkmark for 1.1 s via `flashActionSuccess()`. On error: `logger.error()` with context. |
| ext-action-map | button.ext-action-btn | Map-pin icon (route map). `aria-label="Route map"`. **Wired (2026-06-30)**: click → `openRouteInMaps(data)` → deduplicates stops from `data.segments`, builds Google Maps Directions URL (origin/waypoints/destination from `stop.name + address`), opens in new tab via `window.open(_blank, noopener,noreferrer)`. No flash — new tab is self-evident confirmation. |
| ext-action-post | button.ext-action-btn | Document+plus icon (create post). `aria-label="Create post"`. **Wired (2026-07-06)**: click → `openPostModal(sheetLoadId)` → PAT modal (patModal.js). |

All three buttons share `.ext-action-btn`: 28×28 px, no border/background, `border-radius:4px`,
hover → subtle grey tint + darker icon. SVGs are static 16×16 stroke-based markup (no page data).
