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

## Sidebar (current state — 2026-06-18, gated 2026-07-20)

**Only built at all if `content/content.js`'s startup gate check finds an active Supabase
session** (`utils/authGate.js`) — see "Content-script login gating" under the popup Account
section. Logged out ⇒ none of the elements below exist in the DOM.

| testid | Type | Function |
|--------|------|----------|
| ext-sidebar | div | Bar container (fixed, top-center). Carries `data-running` attr ("true"/"false") which drives all CSS visual state — play/pause icon swap, scanline animation. |
| ext-sidebar-title | span | "Amazon Relay Helper" title text. |
| ext-playpause | span[role=button] | Play ↔ pause pill. SVG icons swap via `#ext-sidebar[data-running] .ext-pp__play/pause` CSS. Click / Enter / Space calls `toggleRunning()` → writes `tabState.running` (per-tab, not storage.local). **Turning ON re-checks the auth gate first** (`recheckAuthGate()`) — a closed gate silently refuses to start (see below), it does not stop an already-running loop. |
| ext-slider-speed | range | Refresh speed 0.5–8 s, step 0.5, default 2. Writes `tabState.refreshIntervalMs` (per-tab). Also calls `applyScanSpeed()` on input. |
| ext-slider-value | span | Live display of slider value, e.g. "2.0s". |
| ext-memory-indicator | span[role=button] | Small dot, `role="button"`, color-interpolated (green→amber→red) from `getHeapUsageRatio()` (content.js), polled every 7s via `setInterval` — independent of the running loop, so it updates while paused. Click or Enter/Space → `location.reload()` directly (dispatcher-initiated only; no automatic trigger). `title`/`aria-label` show live %. Added 2026-06-30, replacing the automatic memory-watchdog reload. |
| ext-memory-info | span | Small "i" icon next to the indicator. Hover (mouseenter/leave), focus/blur, and click/tap all toggle a custom tooltip child (`ext-memory-tooltip`) — explains the reload, that filters will need re-entry, via `textContent`. Added 2026-06-30. |
| ext-memory-tooltip | div | Child of `ext-memory-info`. Positioned absolute under the info icon, shown via `.ext-tooltip-visible` class. Text set with `textContent` only. |
| (ext-scanline) | div.ext-scanline | No testid — purely decorative. CSS-only animation along bottom edge when running. Speed tied to `--ext-scan-dur` CSS var. |

**Removed sidebar elements:** `sidebar-surge-label`, `sidebar-surge-threshold` (removed 2026-06-18 — per-tab threshold still live in tabState/priceSurge, just no longer surfaced in sidebar UI).

**Removed elements (no longer in DOM):** `ext-btn-toggle`, `ext-status`, `ext-count`.

## Popup — Account / login (popup/popup.html, popup.js — 2026-07-17, gating added 2026-07-20, login-only view + 6-10 digit codes 2026-07-20)

Supabase email-OTP login. Three mutually-exclusive steps toggled via the `hidden` attribute
by `showAuthStep()`. Sits above "Display & Alerts" as its own "Account" section. **Now gates
every extension feature, both on the Relay page and in the popup itself** — see
"Content-script login gating" and "Popup login-only view" below.

| testid | Type | Function |
|--------|------|----------|
| popup-auth-gate-note | div | Headline shown whenever not logged in (email or code step): "Free access — sign in with your email to activate Torren Relay". Styled as an actual headline (14px/700) as of 2026-07-20 — previously a small muted note reading "Sign in with your email to activate Torren Relay — free." Hidden on step 3 (logged in). |
| popup-auth-step-email | div | Step 1 container (visible by default). |
| popup-auth-email | input[email] | Email address input. |
| popup-auth-send-code | button | "Send code". Click → `supabase.auth.signInWithOtp({ email })`. On success advances to step 2, sets `pendingAuthEmail` in memory, and **persists `{ pendingEmail, step: 'code' }` to `chrome.storage.local` under `AUTH_PENDING_KEY`** (2026-07-20 fix — see below). |
| popup-auth-step-code | div | Step 2 container (hidden by default). |
| (label, no testid) | label | "Code from email" — added 2026-07-20, `<label for="popup-auth-code">` (`.popup-auth-field-label`), directly above the code input. |
| popup-auth-code | input[text] | OTP code input. **Changed 2026-07-20:** `maxlength="10"` (was `6`), placeholder "Digits only" (was "6-digit code") — Supabase sends 8-digit codes, which the old 6-char cap silently truncated. `inputmode="numeric"`, `pattern="[0-9]*"`, `autocomplete="one-time-code"`. |
| popup-auth-verify | button | "Verify". Click-handler validation **changed 2026-07-20**: `/^\d{6,10}$/.test(code)` (digits only, length 6–10, not a fixed length) replacing the old "non-empty" check; error "Code must be 6-10 digits, numbers only." On success → `supabase.auth.verifyOtp({ email: pendingAuthEmail, token, type: 'email' })`; session saved to `chrome.storage.local` (`SUPABASE_SESSION_KEY`), `AUTH_PENDING_KEY` cleared, advances to step 3. |
| popup-auth-resend | button (link style) | "Resend code" — re-calls `signInWithOtp` for `pendingAuthEmail`. |
| popup-auth-change-email | button (link style) | "Use different email" — clears `pendingAuthEmail`, `AUTH_PENDING_KEY`, and the code input, returns to step 1. |
| popup-auth-step-loggedin | div | Step 3 container (hidden by default). Sits at the top of the popup — email + Log out — with `popup-features` (all feature controls) immediately below. |
| popup-auth-email-display | span | Logged-in user's email, set via `textContent`. |
| popup-auth-logout | button (link style) | "Log out". Click → `supabase.auth.signOut()` (best-effort, errors swallowed/logged), clears `SUPABASE_SESSION_KEY` and `AUTH_PENDING_KEY`, returns to step 1. |
| popup-auth-status | div | Status/error line shared by all three steps (e.g. "Code sent to…", "Invalid code."). `.popup-auth-status--error` class on failure. `textContent` only. |
| popup-features | div | **New 2026-07-20.** Wraps every feature control — "Display & Alerts" section title through the "Booking" section and the `popup-reset` footer — in one container. `hidden` whenever the current auth step is not `'loggedin'`; see "Popup login-only view" below. |

**Pending-state persistence (BUG fix, 2026-07-20):** `pendingAuthEmail` used to live only in a
JS variable, lost every time the popup closed — closing the popup after "Send code" but
before entering it silently dropped the dispatcher back to the email step, forcing a resend.
Now `AUTH_PENDING_KEY` (`utils/storage.js`) persists `{ pendingEmail, step: 'code' }` across
popup close/reopen, cleared only on successful verify, "Use different email", or logout. On
popup open, `restoreSession()` still takes priority (valid/refreshable session → step 3
directly); only when there is no valid session does `restorePendingOrEmailStep()` check for a
pending email and resume step 2, otherwise falling back to step 1.

**Depends on:** `vendor/supabase.min.js` (vendored) and `utils/supabaseConfig.js` (holds
`SUPABASE_URL`/`SUPABASE_ANON_KEY`). Live since 2026-07-17 — real project credentials
supplied by the PM.

### Popup login-only view (2026-07-20)

Previously the popup showed the Account/login block and every feature control at the same
time regardless of login state — gating only existed on the Relay page (content scripts), not
in the popup UI itself. Now `showAuthStep(step)` — already the single place that decides
which of the three auth steps is visible — also sets `popup-features.hidden = step !==
'loggedin'` in the same call, so the two can never disagree:

- **Logged out** (email or code step): only the "Account" section title, the
  `popup-auth-gate-note` headline, and the active auth-step form are visible. Nothing under
  `popup-features` — Display & Alerts, Sound, Price Surge, Load Board Filters, Booking,
  Reset — renders at all.
- **Logged in:** `popup-auth-step-loggedin` (email + Log out) shows at the top, and
  `popup-features` un-hides immediately below it, restoring every control.

The underlying inputs inside `popup-features` still exist in the DOM and still get
initialized/wired by the rest of `popup.js` on every popup open, whether or not the container
is visible — only visibility is gated, matching the same "gate visibility, not existence"
approach as the content-script side (`utils/authGate.js`).

### Content-script login gating (2026-07-20)

Every extension feature on the Relay page now requires an active Supabase session, checked
via the new shared module `utils/authGate.js` (`getAuthGate()` / `recheckAuthGate()`). Two
checkpoints:

1. **content-script startup** (`content/content.js`'s top-level IIFE): if the gate is closed,
   `buildSidebar()` and `initManualToggle()` are never called — no sidebar, no inline panel,
   no click listeners of ours exist on the page at all. `content/nightMode.js`,
   `content/filterSimilar.js`, and `content/filterTags.js` each independently self-initialize
   on script load (not through content.js's orchestrator), so each was given its own gate
   check + an `_...Authed` flag guarding its live `chrome.storage.onChanged` listener, so a
   settings change from another popup instance can't apply Night Mode etc. to a logged-out tab.
2. **the sidebar's play/pause toggle** (`ext-playpause` → `toggleRunning()` in
   `content/sidebar.js`): re-checks the gate (via `recheckAuthGate()`, bypassing the startup
   cache) only when turning the loop **on**, since a tab can sit open for hours after the
   initial check. A closed gate here silently refuses to start (temporarily changes the
   button's `title` to a sign-in prompt, then reverts after 3s) — it never touches Amazon's
   DOM or logs the dispatcher out.

**Silent refresh, not logout:** if the stored session is expired but the refresh token is
still valid, `authGate.js` calls `auth.refreshSession()` and writes the refreshed session
back to storage — the gate reports active with no interruption. Only a genuinely invalid
refresh token closes the gate, and even then `authGate.js` never clears the stored session
itself (that stays `popup.js`'s job, to avoid multiple open tabs racing to log the dispatcher
out over what might just be a transient network error).

**Known limitation — no live reactivation:** logging in or out via the popup does not
retroactively activate/deactivate an already-loaded Relay tab. The gate is only evaluated at
content-script startup (page load) and at toggle-time; a tab reload is required to pick up a
login/logout that happened after the page loaded. Tracked in BACKLOG.md.

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
| ext-pat-permile | input[type=number] | Offer per mile ($/mi). Linked to payout via board distance. Starts empty if board payout is missing/unparseable (see `ext-pat-payout` below) — can't derive $/mi from nothing. |
| ext-pat-payout | input[type=number] | Total offer payout ($). **Changed 2026-07-20:** default = `boardPayout × 1.10` (`PAT_PAYOUT_MARKUP_RATE`), rounded to 2 decimals — replaces the old flat `payoutNum + 5000` (`PAT_TEST_MARKUP_USD`). Linked to per-mile. **Missing-payout edge case:** if board payout is missing/unparseable (`payoutNum` null or `parseNumStr` falls back to `0`), this field starts **empty** — no silent fallback value — and pairs with `ext-pat-payout-warning` + Confirm-disable below. |
| ext-pat-payout-warning | div | **New 2026-07-20.** Sits directly under `ext-pat-payout`. Red text: "Board payout could not be read — enter payout manually". Visible only while the field's current value is not a valid positive number — toggled live on every `input` event via `updateConfirmEnabled()`, not just at render time. |
| ext-pat-stem | select | Stem time (minimum pickup buffer). Options: 5/15/30/45/60/90/120/150/180/210/240/480/720/1440 min. Default 30 min. |
| ext-pat-exclude-swing | checkbox | "Exclude Swing Door loads". Default checked → `excludeSpecialServices:["SWING_DOOR"]`. |
| ext-pat-summary | div | Summary line: "Equipment: X (Provided) Loading Type: Y". Static text. |
| ext-pat-cancel | button | Dismiss modal without submitting. |
| ext-pat-confirm | button | Validate → `buildPatPayload()` → `submitOrder()`. Disabled until cities resolve **and** `ext-pat-payout` holds a valid positive number (`updateConfirmEnabled()`, 2026-07-20 — previously only gated on city resolution). Disabled + "Submitting…" during POST. Green "Post created ✓" on success; modal fades and closes after 2.5s. Re-enables on error. |
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
