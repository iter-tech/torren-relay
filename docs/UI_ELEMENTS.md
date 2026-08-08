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
| ext-sidebar | div | Bar container (fixed, top-center). Carries `data-running` attr ("true"/"false") which drives all CSS visual state — play/pause icon swap, scanline animation. **2026-07-30: `display:flex;flex-direction:column`** (was a single fixed-height row) — `.ext-sidebar-row1` (all pre-existing controls) plus an optional `ext-shared-rate-status` second row (see below) grow it from 40px to 60px. `document.body`'s `padding-top` is now set dynamically in JS (`syncBodyPadding()`), not a static CSS rule, since the bar's height varies. **2026-07-30 (later same day): `overflow:visible`** (was `hidden`) — both info tooltips hang below the bar and were being clipped out of existence by it; `position:fixed` would not have escaped the clip either, since this element's `transform` makes it the containing block for fixed descendants. Nothing relied on the clip (`.ext-scanline` has its own). Also `max-width:calc(100vw - 16px)` — added so the long paused-banner text could not grow this auto-width, centre-anchored bar off both edges of a narrow viewport; **kept after that banner was removed 2026-07-31** because it is what bounds row 2's width so its own ellipsis can trigger. |
| ext-sidebar-title | span | Title text. Reads `EXT_NAME` from `utils/constants.js` — **"Torren Relay" as of 2026-07-30** (was `"Amazon Relay Helper"`, the pre-rebrand name, which left the sidebar disagreeing with the manifest's shipped `name`). This is the only reader of `EXT_NAME` anywhere in the codebase. |
| ext-playpause | span[role=button] | Play ↔ pause pill. SVG icons swap via `#ext-sidebar[data-running] .ext-pp__play/pause` CSS. Click / Enter / Space calls `toggleRunning()` → writes `tabState.running` (per-tab, not storage.local). **Turning ON re-checks the auth gate first** (`recheckAuthGate()`) — a closed gate silently refuses to start (see below), it does not stop an already-running loop. **Stays visible during a rate-limit pause as of 2026-07-30** (it used to hide with the slider): the paused state clears only on a successful response, and a stopped extension issues no requests, so hiding the one control that can restart it could strand the dispatcher. Still true after the paused banner's removal 2026-07-31 — and now more load-bearing, since there is no on-screen text explaining a pause at all. |
| ext-slider-speed | range | Refresh speed 0.5–8 s, step 0.5, default 2. **GLOBAL as of 2026-07-20** — writes `chrome.storage.local[globalRefreshIntervalMs]`, applies to every open Relay tab (was per-tab `tabState.refreshIntervalMs` before that date). Also calls `applyScanSpeed()` on input. Lives in `.ext-sidebar-row1` (2026-07-30 — see `ext-sidebar` below). |
| ext-slider-value | span | **Mode-aware label as of 2026-07-30** (was a bare "2.0s"). "Shared refresh limit" OFF → `"Refresh every X.Xs"`; ON → `"Shared rate: 1 refresh / X.Xs"` (the slider now describes the GLOBAL budget, not this tab's own pace). Written by `renderModeLabel()`, called from every place the interval/mode/backoff state changes. |
| ext-shared-rate-status | div | **New 2026-07-30.** Row 2 of the sidebar, below `.ext-sidebar-row1`. Visible only when "Shared refresh limit" is ON **and** the rate limiter is not paused. The paused condition was originally there because row 1's `ext-rate-limit-banner` already communicated the pause, so this line hid rather than duplicating it; **that banner was removed 2026-07-31 but this condition was deliberately left in place** (different element, out of that task's scope) — so while paused this row simply disappears and the bar is 20px shorter, with nothing explaining why. Uses `isRateLimitPaused()`, which is now its only consumer. Text: `"1 active tab → refreshing every X.Xs"` when N=1, else `"Active tabs: N → each tab refreshes every X.Xs"`, X = interval × N. N comes from `ACTIVE_TAB_COUNT_KEY` (`extActiveTabCount`) — background.js's own active-tab registry, live-synced via `chrome.storage.onChanged`, the same source (not a second counter) the permit system's tab-heartbeat mechanism maintains. Written by `renderSharedRateStatus()`. |
| ext-memory-indicator | span[role=button] | Small dot, `role="button"`, color-interpolated (green→amber→red) from `getHeapUsageRatio()` (content.js), polled every 7s via `setInterval` — independent of the running loop, so it updates while paused. Click or Enter/Space → `location.reload()` directly (dispatcher-initiated only; no automatic trigger). `title`/`aria-label` show live %. Added 2026-06-30, replacing the automatic memory-watchdog reload. |
| ext-memory-info | span | Small "i" icon next to the indicator. Hover (mouseenter/leave), focus/blur, and click/tap all toggle a custom tooltip child (`ext-memory-tooltip`) — explains the reload, that filters will need re-entry, via `textContent`. Added 2026-06-30. |
| ext-memory-tooltip | div | Child of `ext-memory-info`. Positioned absolute under the info icon, shown via `.ext-tooltip-visible` class. Text set with `textContent` only. **Note (2026-07-30): this was silently clipped away by `#ext-sidebar{overflow:hidden}` and had never actually rendered**; fixed as a side effect of adding `ext-rate-limit-tooltip` — see the `ext-sidebar` row. |
| (ext-scanline) | div.ext-scanline | No testid — purely decorative. CSS-only animation along bottom edge when running. Speed tied to `--ext-scan-dur` CSS var. |

### Active origin cities panel (`content/originCities.js`) — new 2026-08-05

Floating panel listing the origin cities currently active in Amazon's load-board filters. Built
by `activateExtensionUI()`, removed by `deactivateExtensionUI()`. Read-only with respect to
Amazon — no clicks, no writes, no requests.

| testid | Type | Function |
|--------|------|----------|
| ext-origin-cities | div[role=complementary] | Panel container, `aria-label="Active origin cities"`. `position:fixed` with **`top`/`left` written by JS at runtime, never in CSS** — see "Placement is measured" below. Wrapping flex **row**: `display:flex; flex-wrap:wrap; align-items:center; gap:8px`, `max-width:calc(100vw - 16px)`. `z-index:2147483646`, one below the sidebar so the sidebar wins any overlap. **Repositioned 2026-08-05** from a fixed bottom-left pin. |
| ext-origin-cities-title | div | Caption "Active origin cities", 10px uppercase muted. **Inline at the left of the row**, not a block heading above it; `flex-shrink:0` keeps it whole when the cities wrap. |
| ext-origin-cities-list | div | Flex **row**, `flex-wrap:wrap; gap:6px`. Cities run left to right and wrap to a second row only when they do not fit. |
| ext-origin-city | div[role=button] | One pill per city. **The click is currently a NO-OP** (2026-08-05) — it is reserved for per-city filtering in a later task. Keeps `role="button"`, `tabindex="0"` and `cursor:pointer` because it remains a button awaiting its action, but **no `click` or `keydown` listener is attached**. `title` is the plain city — no action hint, since none is performed. Carries `data-city` = the exact extracted city string (also the storage key). **Sizing (2026-08-05): `font-size:14px`, `padding:8px 14px`** — was 12px / `1px 6px`, which gave a ~19px-tall target that was fiddly to hit; now ~35.5px tall and ~28px wider than its text. Token-coloured pill (`--ext-n100` bg, `--ext-n200` border), `white-space:nowrap`. |
| ext-origin-city-label | div | The city text — **currently the pill's only child in every state.** Explicit `font-size:14px` so it cannot drift if the pill's own size changes. `textContent` only (page data). |
| ext-origin-driver-name | div | **Not currently rendered.** The driver name as primary label, shown when renaming was reachable. 12px/600, `--ext-n700`. CSS retained for re-wiring — see the rename note below. |
| ext-origin-city-sub | div | **Not currently rendered.** The city text beneath a driver name — 10px, `--ext-n500`. CSS retained for re-wiring. (`--ext-text-muted` does not exist in `designTokens.js`; `--ext-n500` is the nearest existing muted token.) |
| ext-origin-name-input | input[type=text] | **Not reachable by click.** The rename field: pre-filled with the current name, `placeholder` = the city, `maxlength="24"`, Enter/blur commits, Escape cancels, empty clears. Still built by `startRenameCity()`, which remains callable. |

**⚠️ Renaming is DISCONNECTED, not deleted (2026-08-05).** Three things were removed from
`buildCityItem()`: the `click` listener, the Enter/Space `keydown` listener, and the two-line
named render. Everything else is intact and callable — `startRenameCity()`, `commitDriverName()`,
`loadDriverNames()`, `ORIGIN_DRIVER_NAMES_KEY`, the `_originNames` cache (still loaded on every
build), the `_originEditingCity` guard, and the CSS for the input, driver name and city sub.
**Stored driver names are not wiped** and reappear when those three are restored. Buttons show
the plain city string meanwhile, even for cities that have a name in storage.

**⚠️ The taller buttons make the panel taller: 33.0px → 49.5px on one row, ~91px when wrapped.**
In the BESIDE branch it now extends ±24.8px from the results-row centre (±45.5px wrapped), so it
reaches further toward the chip band; in the BELOW branch it covers ~17px more of the chips and a
wrapped panel could reach the first load card. Not adjusted — see TC-ORIGIN-1 step 6.

**Driver names (2026-08-05).** Persisted in `chrome.storage.local` under
`ORIGIN_DRIVER_NAMES_KEY` (`extOriginDriverNames`) as `{ "LITTLE ROCK, AR": "Mike" }` — key is the
city string exactly as extracted. Declared **outside `STORAGE_KEYS`** so "Reset to Defaults"
(which removes `Object.values(STORAGE_KEYS)`) cannot wipe them. **Never pruned** when a city
leaves the filters. Loaded before the first render, so no raw-city flash; a storage failure logs
and renders plain city names.

Names are **per-profile, not per-tab** — the same city shows the same name in every tab. An
already-open tab does **not** repaint when another tab renames (no `chrome.storage.onChanged`
listener); it picks the change up on its next list change or reload.

**Max name length 24**, enforced on the input and again on commit. Long names make the panel
**grow and wrap**, never truncate.

**Key events (`keydown`/`keypress`/`keyup`) are stopped at the panel** so typing a driver name
cannot reach Amazon's document-level shortcut handlers. `stopPropagation`, not
`stopImmediatePropagation` — the input's own Enter/Escape handlers must still run.

**Anchored to the results-count line, placed by a rAF loop (rewritten 2026-08-05).** The anchor is
Amazon's `Showing N results` text — matched by TEXT, **never by class or id**: the first **leaf**
element (no element children) whose trimmed `textContent` matches `/^Showing\b.*\bresults?$/`.
`findAnchorRow()` walks up to the nearest **ancestor** with a non-zero height — that is the row.

| Branch | When | Placement |
|---|---|---|
| **BESIDE** | ≥200px free to the right of the text (measured against the **viewport**, since the panel is `position:fixed`) | vertically centred on the row via `transform:translateY(-50%)`, left = text's right + 16px |
| **BELOW** | under 200px free | `row.bottom + 6px`, left = `row.left`, transform cleared |
| **fallback** | anchor not found | `top:8px / left:8px` + `logger.warn` |

Each branch logs once on transition, not per frame.

**Why this anchor, not the chips:** the results-count line sits **above** the chip band, so the
panel no longer lands on the load list — which the previous below-the-chips placement did.

**Placement runs on a `requestAnimationFrame` loop, not a debounce.** The dispatcher collapsing
Amazon's left filter panel reflows the whole board; a debounced reposition made the panel visibly
**snap** into place afterwards. The loop reads the anchor every frame and writes `top`/`left` only
when either moved by more than 0.5px. Started on build, cancelled in teardown — leaving it running
after logout would be a permanent ~60fps callback. The former `resize` and `scroll` listeners were
**removed as redundant**: both only ever signalled "the anchor may have moved", which the loop
observes directly.

**Cost per frame: 2 `getBoundingClientRect()` calls, 0 style writes when still.** The anchor
element is **cached**; it is not re-queried per frame. A full-document rescan happens only when
the cached node leaves the DOM.

**⚠️ Overlap.** It cannot cover the results-count text (BESIDE starts 16px to its right; BELOW
clears the whole row). It **can** cover the **chip band** in the BELOW branch, which places it at
`row.bottom + 6px` — exactly where the chips are — at narrow widths. Its relationship to Amazon's
**sort control** is **unverified**: that control's position relative to the results-count row has
never been captured. z-index `2147483646` vs the sidebar's `2147483647`; against Amazon's own
elements it is **unverified** — no capture of Amazon's z-index exists in this repo.
| ext-origin-cities-empty | div | Shown instead of rows when no origin filter is applied: "No origin cities in filters". Italic/muted. The panel stays visible rather than disappearing, so its absence never reads as a broken extension. |
| ext-origin-cities-style | style | Injected stylesheet, id `ext-origin-cities-style`, removed on teardown. |

**Extraction is text-based, never class-based.** The chips are `div.css-1w1nhw5 > div.css-e7fmj9 >
span`, all generated CSS-in-JS hashes. `readActiveOriginCities()` instead collects every `<span>`
whose trimmed `textContent` starts with `"Origin city: "` and slices off that prefix. It trims
(Amazon ships stray whitespace on this board — the Filter button's `aria-label` is literally
`"Filter  "`) and de-duplicates (a nested outer span's `textContent` also matches the prefix).

**Night mode needs no work.** Every colour is a `var(--ext-*)` design token, and those already
carry `html.ext-night` overrides in `utils/designTokens.js`. `content/nightMode.js` was **not**
modified.

**Live updates** via a debounced (200ms) `MutationObserver` on `document.body`
(`childList` + `subtree`) — anchored on body for the same reason `loadObserver.js` is, since
Amazon is a React SPA that unmounts and remounts the filter containers. Two self-trigger guards:
mutations originating inside the panel are ignored, and `refreshOriginCities()` re-renders **only
when the extracted list actually changed**, which makes a feedback loop impossible even if the
first guard were loosened.

**Removed sidebar elements:** `sidebar-surge-label`, `sidebar-surge-threshold` (removed 2026-06-18 — per-tab threshold still live in tabState/priceSurge, just no longer surfaced in sidebar UI). `ext-rate-limit-banner`, `ext-rate-limit-text`, `ext-rate-limit-info`, `ext-rate-limit-tooltip` (removed **2026-07-31** by PM decision — the paused/rate-limit message and the "i" icon that existed only to accompany it. The backoff/pause behaviour behind it is unchanged and still live; **nothing about the paused state renders in the UI any more**. Full reinstatement record — elements, CSS, call sites, driving state — in BACKLOG.md "Sidebar paused/rate-limit message"). Side effects of that removal: `ext-slider-speed`/`ext-slider-value` no longer hide during a pause (the hiding existed only to make room for the banner), and `ext-shared-rate-status` still hides while paused, so the bar is simply 20px shorter with no explanation shown.

**Removed elements (no longer in DOM):** `ext-btn-toggle`, `ext-status`, `ext-count`.

## Popup — Account / login (popup/popup.html, popup.js — 2026-07-17, gating added 2026-07-20, login-only view + 6-10 digit codes 2026-07-20)

Supabase email-OTP login. Three mutually-exclusive steps toggled via the `hidden` attribute
by `showAuthStep()`. Sits above "Display & Alerts" as its own "Account" section. **Now gates
every extension feature, both on the Relay page and in the popup itself** — see
"Content-script login gating" and "Popup login-only view" below.

| testid | Type | Function |
|--------|------|----------|
| popup-auth-gate-note | div | Headline shown whenever not logged in (email or code step): "Free access — sign in with your email to activate Torren Relay". Styled as an actual headline (14px/700) as of 2026-07-20 — previously a small muted note reading "Sign in with your email to activate Torren Relay — free." Hidden on step 3 (logged in). **2026-07-30: now also `hidden` in the markup** — it no longer renders by default, only once `showAuthStep()` says so. |
| popup-auth-step-email | div | Step 1 container. **`hidden` by default as of 2026-07-30** (was visible by default — that is what flashed the login form at signed-in dispatchers for ~1–1.5s). |
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
| popup-auth-status | div | Status/error line shared by all three steps (e.g. "Code sent to…", "Invalid code."). `.popup-auth-status--error` class on failure. `textContent` only. **2026-07-30:** also carries "No connection — check your internet." when background session validation cannot reach the server — inline and non-blocking, on the logged-in panel as well as the login form. Reused deliberately so the connection notice needs no new element. |
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

### First paint decided locally; validation is a background step (2026-07-30)

The gating above answers *which* block to show. This answers **when it can be decided** — and
the answer is "immediately, from `chrome.storage.local`, with no network involved".

Every auth block and `popup-features` carries `hidden` in the markup, so nothing renders on
spec. `restoreSession()` reads the stored session, and if it exists with
`expires_at - now > 30` it calls `showLoggedIn()` straight away; otherwise the login form (or,
with a pending OTP, the code step) goes up straight away. Only then does the Supabase call run,
against a UI that is already on screen.

**Why this is safe:** the stored session already carries `expires_at` and `user.email` — the
only things the panel needs. The `storage.onChanged` handler at the bottom of `popup.js` has
always rendered the logged-in state from exactly this data with no network call.

*Superseded:* an earlier iteration the same day added a neutral `popup-auth-checking`
("Checking your session…") placeholder with a 3000ms bounded wait. Both are removed — they
existed only to manage a wait on the network that no longer happens.

**A dropped connection never logs anyone out.** When background validation fails, `popup.js`
distinguishes a server verdict from an unreachable server (`isServerVerdict()`, backed by the
Supabase bundle's own `isAuthRetryableFetchError`):

- **Server says the session is invalid** → clear it, show the login form, as before.
- **Could not reach the server** (offline, DNS, 5xx, or any non-auth error) → change nothing.
  The dispatcher stays signed in, the stored session is untouched, and `popup-auth-status` shows
  "No connection — check your internet." inline. **No new UI element** — the existing shared
  status line carries it.

Accepted trade-off (PM decision): a server-revoked session shows the panel for a few hundred ms
until validation corrects it. See TEST_CASES.md TC-AUTH-9.

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
| popup-shared-limit | checkbox | "Shared refresh limit" toggle. **Wired (2026-07-20)** → writes `sharedRefreshLimitEnabled` to `chrome.storage.local`. **True-default.** When ON (default): every open Relay tab's `content.js orchestratorTick()` requests a permit from `background.js` before refreshing, enforcing one shared global pacing floor (`GLOBAL_MIN_PERMIT_INTERVAL_MS`) across all tabs. When OFF: each tab still sends the permit request (so 503 backoff keeps working — never optional) but `background.js` skips the pacing wait and grants immediately, restoring independent per-tab firing. Live-synced across tabs via `chrome.storage.onChanged` — takes effect on the next tick, no reload. Reset restores to ON. |
| popup-shared-limit-info | span (button role, tabindex=0) | Circled "i" info icon next to the Shared refresh limit label. **Wired (2026-07-20)** → `mouseenter`/`focus` show, `mouseleave`/`blur` hide `.popup-tooltip-visible` on the adjacent tooltip. Not a native `title` attribute (unreliable on keyboard focus). |
| popup-shared-limit-tooltip | span (role=tooltip) | Tooltip text for the info icon above. **Wired (2026-07-20)** → static content: "Amazon blocks too-frequent refreshes and can temporarily cut off access from your IP. This mode shares one refresh budget across all your tabs so you don't hit that limit. Turn it off to give each tab its own timer." |
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
| ext-inline-panel | div | Outer wrapper. `id="ext-inline-panel"`. **`width:100%;box-sizing:border-box` added 2026-07-20** — fixes a layout bug where the panel (inserted as a sibling of the load card, likely into a flex/grid list container) shrank to its content's natural width instead of filling the card's row, making the segment table below render at roughly half width, left-aligned. |
| ext-seg-header | div | Collapsible segment header (multi-segment loads only). `display:grid` with 6 fixed columns: `40px minmax(0,3fr) 1.4fr 1fr 1fr 32px` — number / route / dist·time / action / status / arrow. Always 6 child spans. Toggles `ext-open` on self + paired body. **Background `var(--ext-leg-header-bg)` = `#F5F5F5` as of 2026-07-31** (history: `#1B3A57` dark navy → `#DCE6E9` → `#CFDBFB` → `#F5F5F5`; the last move brought the spec colour here from `.ext-seg-body`, which had been the wrong surface). Light mode only — `content/nightMode.js:130` overrides `background-color` with `DK_HIGH !important`, so the token value is never exercised in dark mode. Text on it: `#1F3A45` base/route codes (11.01:1) and `#4A6570` distance/arrow/chevron (5.69:1), both clearing WCAG AA. **Note:** against the now-`#FFFFFF` body this header is only 1.090:1, so the `border-bottom:1px solid #C4D2D6` is what actually separates the two. |
| (ext-route-origin) | span | Origin code, column 1 (`1fr`) of `.ext-seg-route` 3-column grid. Monospace, centered, wraps within its half. `min-width:0`. |
| (ext-route-arrow) | span | Route connector `→`, column 2 (`auto`) — glyph width only, always centered. Bold, 1.15em, `#1a5c38`. |
| (ext-route-dest) | span | Destination code, column 3 (`1fr`). Monospace, centered, wraps within its half. `min-width:0`. Contains an `.ext-stop-num` circle (destination global stop#) prepended before the code text. |
| (ext-seg-loaded) | class on `.ext-seg-status` | "Loaded" — plain text, `#1a5c38` green, font-weight 500. No pill. |
| (ext-seg-empty) | class on `.ext-seg-status` | "Empty" — plain text, muted `#878787`. No pill. |
| (ext-seg-action) | span | Action text (Drop/Live/Preloaded) — plain text, muted `#565959`. No pill. |
| ext-seg-body | div | Segment table container. `display:none` until `ext-open`. **Background `#FFFFFF`** — briefly `#F5F5F5` on 2026-07-31 before that colour was moved to `.ext-seg-header` (wrong surface); restored the same day. Light mode only — `content/nightMode.js:224` overrides it with `DK_HIGH !important`. Text on it: `.ext-stop-addr` `#6B7280` at 4.83:1 and `.ext-inline-panel__table td b` `#111827` at 17.74:1, both clearing AA. Even-row zebra tint `var(--ext-n100)` = `#f5f7fa` sits at 1.073:1 against it — its original designed subtlety, decorative only. |
| ext-inline-panel__table | table | Stop rows. `table-layout:fixed`, columns 40/20/20/20% (Stop widest; Equipment/Id, Arrival, Departure equal — unchanged by the 2026-07-20 fix, was already correct). **2026-07-20:** cell padding unified to `10px 14px` for both `th`/`td` (was `8px`/`10px`, inconsistent); `border-bottom` unified to `var(--ext-n200)` for both (was `var(--ext-n200)`/`var(--ext-n100)`, a mismatched shade); new `border-right:1px solid var(--ext-n200)` on all but the last column (column separators, matching Amazon's own current bordered-table style — previously row separators only); `th` gained `background:var(--ext-n100)` (header now visually distinct from data rows — previously no background at all) and explicit `vertical-align:middle`. All new colors are `var(--ext-n200)`/`var(--ext-n100)`; `content/nightMode.js`'s existing overrides (universal border-color reset + explicit `thead th`/`tbody td` rules) already adapt these for Night Mode — no `nightMode.js` change made. |
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
