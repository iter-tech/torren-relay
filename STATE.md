# Project State

Last updated: 2026-07-30

**Full-codebase audit: 2026-07-30.** Scope: `content/`, `utils/`, `popup/`, `background.js`,
`manifest.json`, `docs/`. Read-only except for a narrow authorised auto-fix class (dead CSS,
unused declarations, literals→constants, duplicate CSS) — see CHANGELOG.md 2026-07-30 "Part B
auto-fixes only" for exactly what changed. **The audit's substantive findings were reported,
not fixed, and remain open.** Highest-ranked open items, by likelihood a real dispatcher hits
them: PAT modal posts `distMiles`/`stopCount` as `0` on parse failure with no warning and no
Confirm gating (posts a wrong load to a live marketplace); `waitForSheet()` has no cancel, so
clicking a second card quickly renders one card's panel from another card's sheet;
~~`_extActivated` is set before the awaits in `activateExtensionUI()`, so a failed activation
permanently blocks retry~~ **(B1 — FIXED 2026-07-30, see below)**; manually-typed payout/per-mile are submitted unrounded; "Reset to
Defaults" does not resync the live refresh interval in open tabs. Pre-launch blockers:
`DEBUG_LEVEL = 2` and — more importantly — `logger.log/warn/error` ignore `DEBUG_LEVEL`
entirely (only `logger.debug` respects it), so 178 `logger.log` sites stay live at any level;
console logs include the dispatcher's email and full street addresses; `EXT_NAME` is still
`'Amazon Relay Helper'` while the manifest ships as `Torren Relay`. Night Mode parity gap:
the PAT modal and sidebar each carry their own graphite dark palette that never migrated to
the navy-slate `DK_*` ramp. Doc drift: `GLOBAL_MIN_PERMIT_INTERVAL_MS` no longer exists but
is still stated as current fact in STATE.md, UI_ELEMENTS.md, and TEST_CASES.md.

**Note on this rewrite:** this file was previously maintained in Ukrainian, last content-updated
2026-07-07 (Stage 14 PAT rework), and had fallen well behind actual repo state — commits
`cb9dbf7`, `512381d`, `a5d1b21`, `23d9706`, plus this whole session's work, were never
reflected in it. Earlier in this session a duplicate `docs/STATE.md` was mistakenly created
(a directory search missed this root-level file) and updated instead of this one for several
turns; that duplicate has been deleted and its content merged in here. Written in English
from this point on, matching every other file in `docs/`.

## Поточна фаза / Current phase

Post-MVP hardening + feature expansion. Core detect/highlight/sound/auto-open loop, LoadUnit
data model, Night Mode, popup wiring (Step 3), PAT ("Post a Truck" / Create Post) Helper, Card
Action Bar, multi-domain support, and Supabase email-OTP login (now gating every feature) are
all built. Working through backlog items and regional/equipment coverage expansion.

## Що завершено / Done

**Core system (Stages 0–13, complete):** MV3 manifest; `utils/constants.js`
(`FORBIDDEN_SELECTORS`, `isForbiddenElement`, `ALLOWED_CLICK_INTENTS`); `utils/logger.js`;
`utils/storage.js` (`STORAGE_KEYS` + async get/set/remove/getAll); `utils/tabState.js`
(per-tab pub/sub store: running, surgeThreshold, priceHistory — `refreshIntervalMs` moved
to a global setting 2026-07-20, see "Cross-tab rate limiting" below);
`content/refreshManager.js`, `loadParser.js`, `loadDetector.js`, `highlighter.js`,
`detailOpener.js`, `inlinePanel.js`, `sidebar.js`, `loadObserver.js` (MutationObserver instant
detection), `panelCloser.js`, `content.js` (orchestrator). `background.js` (service worker)
added 2026-07-20 — see below.

**Step 3 — popup controls wired:** Night Mode, Tab Alert, Hide Similar Matches, Auto-Open Top
Load (true-default), Sound block (25 sounds, volume, preview), Hide tag filters (Promoted /
Starting soon / Trailer ready / Booked before), Price Surge Alert (per-tab threshold via
tabState), Reset to Defaults.

**LoadUnit data model ✅** (`utils/loadStore.js`) — in-memory per-tab store, Phase 1 (board
fields) wired in `loadParser.js`, Phase 2 (detail struct) wired in `inlinePanel.js`.

**Card Action Bar ✅** — Copy Screenshot (`html2canvas`, vendored), Route Map (Google Maps
Directions URL), Create Post (opens PAT modal).

**PAT Helper (Stage 14) ✅** — `content/patApi.js` + `content/patModal.js`. Equipment support:
53' Trailer, 53' Container and Chassis, 40' Container, 26' Truck (commit `23d9706`). City
resolution via live API with dotted-abbreviation + prefix/subsequence fallbacks, draggable
modal, payout rounding (commits `a5d1b21`, `512381d`). **Default Payout markup changed
2026-07-20:** flat `PAT_TEST_MARKUP_USD = 5000` → `PAT_PAYOUT_MARKUP_RATE = 1.10` (board
payout × 1.10, rounded to 2 decimals), dispatcher can still edit freely. Edge case: if board
payout is missing/unparseable, Payout is left **empty** (no silent fallback), a visible
warning (`ext-pat-payout-warning`) shows "Board payout could not be read — enter payout
manually", and Confirm stays disabled until a valid amount is entered — see
`updateConfirmEnabled()` in `patModal.js`. `docs/SAFETY.md` updated to reflect that the old
markup's "obviously fake price" safety property no longer applies (10% is a plausible real
offer); the dispatcher-must-click-Confirm gate is now the primary control for this feature.

**Multi-domain support ✅ (2026-07-17)** — `manifest.json` `host_permissions` /
`content_scripts.matches` cover all 11 Amazon Relay regional domains (ca, co.jp, co.uk, com,
cz, de, es, fr, it, in, pl). No hardcoded-domain code changes needed elsewhere —
`content/patApi.js` already used relative fetch paths. Non-US locale handling (city/address
format differences) explicitly deferred until real captured data exists.

**Supabase email-OTP login ✅ live (2026-07-17, hardened 2026-07-20):**
- Three-step "Account" section in the popup (email → code → logged-in). `vendor/supabase.min.js`
  (supabase-js v2.110.7 UMD, vendored — MV3 forbids remote scripts) + `utils/supabaseConfig.js`
  (`SUPABASE_URL`/`SUPABASE_ANON_KEY`, real project credentials from the PM, **gitignored** —
  `utils/supabaseConfig.example.js` is the committed placeholder template).
- **Pending-state bug fixed (2026-07-20):** "Send code" now persists
  `{ pendingEmail, step: 'code' }` to `chrome.storage.local` (`AUTH_PENDING_KEY`) — previously
  in-memory only, so closing the popup before entering the code silently reset the flow.
  Popup reopen now resumes the code step if a pending email is stored.
- **OTP code length fixed (2026-07-20):** Supabase sends 8-digit codes; the input used to hard
  cap at 6 and reject them. Now accepts 6–10 digits (`maxlength="10"`, validated via
  `/^\d{6,10}$/` — digits only, not a fixed length). Label added: "Code from email".
- **Full feature gating (2026-07-20):** every extension feature now requires an active
  session, via new shared module `utils/authGate.js` (`getAuthGate()` cached /
  `recheckAuthGate()` fresh). Checked at content-script startup (`content.js` — closed gate
  ⇒ no sidebar, no inline panel, zero extension DOM on the page) and again when the sidebar's
  play/pause is turned on (`recheckAuthGate()`, since a tab can sit open for hours).
  `nightMode.js`, `filterSimilar.js`, `filterTags.js` each self-initialize independently of
  `content.js`, so each got its own gate check + a guard flag on its live
  `chrome.storage.onChanged` listener. An expired-but-refreshable session refreshes silently
  (never logs out); content scripts never clear a bad session themselves (that stays
  `popup.js`'s job, avoiding multi-tab races). **Popup gating UI (2026-07-20):** when logged
  out, the popup shows only the login block — headline "Free access — sign in with your email
  to activate Torren Relay" (`popup-auth-gate-note`) plus the email/code form; every feature
  control (Display & Alerts, Sound, Price Surge, Load Board Filters, Booking, Reset) lives in
  a single `popup-features` container gated by the same `showAuthStep()` that drives the auth
  steps. Logged-in state shows email + Log out at top, features below.
- **Live activation/deactivation, no reload required (2026-07-20 — TASK 1, resolves the
  "known limitation" above):** `utils/authGate.js` gained `onAuthGateChange(callback)` +
  a `chrome.storage.onChanged` listener on `SUPABASE_SESSION_KEY` — any login/logout via the
  popup is detected on every already-open Relay tab within about a second, via a real
  active↔inactive transition check (`_handleGateResult`), not on every session write (a
  silent refresh must not re-fire "activate"). `content/content.js` split its startup logic
  into idempotent `activateExtensionUI()` / `deactivateExtensionUI()`, both wired to
  `onAuthGateChange` — login instantiates sidebar + inline panel + loop exactly as if the
  page had loaded already logged in; logout stops the loop, removes the sidebar/inline
  panel/highlights, and reverts the page to fully untouched, all without a reload.
  `content/nightMode.js`, `filterSimilar.js`, `filterTags.js` each gained their own
  `activate*()`/`deactivate*()` pair for the same reason (they self-initialize independently
  of `content.js`). `content/inlinePanel.js`'s one-time-registered manual-toggle click
  listener now checks `isAuthGateActiveSync()` on every click (it can no longer assume
  "if I exist, we're logged in"). Fixed two real leaks this surfaced: `utils/tabState.js`
  gained `unsubscribe()` (repeated login/logout cycles were adding a permanent subscriber
  each time), and `content/sidebar.js`'s memory-poll `setInterval` is now stashed on the
  sidebar container and cleared on deactivation (was previously unclearable, would have
  polled forever against detached DOM after every logout). **Not yet exercised in a
  browser** — see docs/TEST_CASES.md TC-AUTH-6 for the exact manual steps required.

**Rebrand to "Torren Relay" — partial, scoped (2026-07-17):** `manifest.json` (`name`,
`default_title`) and popup (`<title>`, `.popup-title`) updated. `description` intentionally
left as-is (full copy rewrite comes before Web Store submission). `utils/constants.js`'s
`EXT_NAME` — which feeds the on-page sidebar title — was **not** changed (out of requested
scope); the injected sidebar still reads "Amazon Relay Helper" until that's folded into a
later rebrand pass.

**Read-only logic audit + 3 fixes (2026-07-20):** a full read-only audit across content/,
utils/, popup/, manifest.json found and ranked logic bugs by severity. Three fixed, one at
a time, each verified with a real Node `vm`/functional test (not just structural checks)
before being reported done: (1) `resolvePATCity()` referenced an undeclared `boardStopStr`
in its empty-city error log, throwing uncaught and — via `Promise.all` — discarding a
sibling city that resolved fine; fixed to use the real parameter, moved inside the
function's `try` block. (2) `patModal.js` silently fabricated a load's start/end time
(`fallbackTime(1)`/`fallbackTime(4)` = "now +Nh") whenever the real time was missing/
unparseable, with Confirm left enabled — posted a fictional availability window; fixed with
the same no-silent-fallback pattern already used for missing Payout (empty field, visible
warning, Confirm blocked live until manually entered). (3) `content.js`'s
`runDetectionPipeline`/`orchestratorTick` never re-checked the login gate or
`tabState.get('running')` across their multiple `await` points, so a logout landing
mid-tick let it finish anyway — highlighting cards, playing sound, and recreating
`#ext-inline-panel` after `deactivateExtensionUI()` had already torn everything down; fixed
with a shared `shouldContinue()` checkpoint after every await plus `clearPipelineDom()` to
make deactivation authoritative regardless of exactly where a tick got interrupted.

**Inline panel CSS — width fix + polish (2026-07-20, three passes):** pass 1 (a hypothesis,
`.ext-inline-panel{width:100%}`) turned out insufficient — reported back by the user with a
live-measured correction. Pass 2 fixed the REAL root cause, found by the user's own live
browser measurement (not a hypothesis this time): Amazon has a global `table{display:block}`
rule on the page, and a block-level table ignores `width:100%` for its own internal layout
(builds an anonymous shrink-to-fit table box instead) — fixed with
`display:table !important;width:100% !important` on `.ext-inline-panel__table`, with a
comment warning not to remove the `!important`. Pass 3 was a design polish pass (segment
header route grouping — required a small DOM restructuring in `buildPanelElement()` since
CSS alone can't merge two sibling grid items into one flex cell; table header/cell
typography; zebra striping, including a Night Mode counterpart in `content/nightMode.js` a
blanket dark-mode override would otherwise have silently erased). All three passes verified
via Node `vm` structural + DOM-shape checks (not live rendering — no browser available);
none of the three has been visually confirmed in an actual browser yet.

**Cross-tab rate limiting (2026-07-20) — PRE-LAUNCH BLOCKER, see docs/BACKLOG.md:**
confirmed with real data — 3-4 Relay tabs, each with its own independent 2s refresh timer,
produced sustained HTTP 503 from Amazon across all tabs (IP-based throttle, confirmed by
switching networks). New `background.js` (this extension's first-ever service worker) acts
as a permit dispenser + backoff state machine, coordinating ONE global request budget
across every open tab via `chrome.storage.local` (not in-memory state — MV3 service
workers are not persistent). New `content/networkObserver.js` (MAIN-world, a new kind of
injection this codebase hasn't used before) observes real HTTP status on
`/api/loadboard/search` read-only, for 503/backoff detection. The refresh-interval slider
moved from per-tab (`utils/tabState.js`) to a global `chrome.storage.local` setting.
Backoff: 5/10/20/40/80s capped at 5min, ±20% jitter, reset only on a real 200. Every tab's
sidebar shows a synchronized amber paused banner while blocked. **Countdown removed
2026-07-30** — it displayed our own backoff timer, which is not Amazon's unblock time, reset
on page reload, and meant nothing on reaching zero; the banner is now static copy plus an "i"
explainer tooltip, and it is gated on a new sticky `rateLimited` display flag (set on any
reported failure, cleared only on a reported 2xx) rather than on `backoffUntil`, so it
survives both timer expiry and a page reload and disappears on the first real success. The
backoff/permit machinery itself is unchanged (A/B verified). `GLOBAL_MIN_PERMIT_INTERVAL_MS = 5000` is explicitly marked empirical/unverified
in its own comment, per instruction — not a confirmed safe rate. **Verified with real
functional tests** (not structural checks — `background.js` has zero DOM dependency): 18/18
on the core permit/backoff algorithm (pacing, FIFO fairness, jitter, backoff schedule,
reset-on-success, and persistence across a simulated service-worker restart) + 4/4 on the
content-script integration. **Not verified in an actual multi-tab browser session** — see
Blockers below and docs/TEST_CASES.md TC-RATELIMIT-1.

**Cross-tab rate limiting made OPTIONAL (2026-07-30 follow-up):** the shared budget from
the item above is no longer forced. New "Shared refresh limit" toggle in the popup
(`popup-shared-limit`, `chrome.storage.local` key `sharedRefreshLimitEnabled`,
true-default, global, live-synced across tabs via `chrome.storage.onChanged` — same
mechanism as the login-state live activate/deactivate). ON = unchanged prior behavior
(shared pacing floor + backoff). OFF = each tab fires on its own schedule with no pacing
coordination — but **503 backoff is never optional**: `background.js`'s
`grantOrDenyPermit()` now checks backoff first, unconditionally, and only gates the
pacing-wait step behind the new flag, so a paused tab still shows the countdown banner in
either mode. A circled "i" icon next to the label shows the exact requested explanatory
tooltip on hover and keyboard focus (adapted from `content/sidebar.js`'s existing
memory-info tooltip pattern — no popup-side precedent existed before this). `content/
sidebar.js` needed zero changes — its rate-limit banner already reads the shared backoff
state directly, independent of any mode. **Verified with real functional tests**
(`background.js`, zero DOM dependency): 15/15 — OFF-mode grants with no pacing wait,
ON-mode (and flag-omitted, for backward safety) still paces at ~5s, backoff denies in both
modes, OFF-mode resumes instantly once backoff clears, success fully resets backoff.
Popup/content.js wiring verified structurally only (source-text assertions — DOM-heavy
files, no browser available). **Not verified in an actual browser** — see
docs/TEST_CASES.md TC-RATELIMIT-2 for the exact manual steps required (tooltip
hover/keyboard behavior, live cross-tab sync, OFF-mode independent timers, OFF-mode
backoff still pausing/showing the banner, Reset default, persistence across restart).

## Що в роботі / In progress

**FIXED 2026-07-31 — payout parsed as null for the entire "Similar matches" section**
(`content/loadParser.js`, one selector). Cause: `.wo-total_payout` matches whole class tokens, and
that section wraps the payout in `wo-total_payout__match-deviation-attr` — one indivisible token,
not a suffixed variant. Selector now matches both. `|| null` guard untouched, `patModal.js` not
modified. 25 automated checks against both real markup shapes; browser half is TC-PARSE-2.

**🔶 Open, needs one capture:** `.wo-total_payout__modified-load-increase-attr` (price-increase
highlight) is a documented third member of the same family and is **still unmatched** — those
loads likely have the same silent null payout. Deliberately not added without proof it is the
payout element and not a preceding badge, since `querySelector` takes document order and a badge
would yield the wrong number. Capture a price-increased card's inner HTML → one-token fix. Also
unverified in that section: the parser's non-`wo-*` selectors (`.equipment-type-text`,
`.trailer-type-circle`, `.loading-type`, `span[title="Deadhead"]`, `#STARTING_SOON`, `div[id]`).
See AMAZON_SELECTORS.md "Payout inner-class family".

**Load row background → #F5F5F5, done 2026-07-31** (`content/inlinePanel.js`, `.ext-seg-body`,
one hex). Light mode only by construction — `nightMode.js` overrides that exact selector with
`DK_HIGH !important`. 12 automated checks; visual half is TC-PANEL-COLOUR-2, not run. **Flagged:**
the zebra striping (`var(--ext-n100)` = #f5f7fa) is now nearly invisible against #F5F5F5. Also
flagged: "load rows" was read as the per-leg body, not the table cells — one-line change if the
other reading was meant.

**⛔ STILL BLOCKED (2nd request) — collapse Amazon's left filters panel on START.** The new
capture (`aria-label="Filter  "`, trailing spaces) **invalidated the selector this repo previously
recommended** — exact-match `[aria-label="Filter"]` matches nothing; BACKLOG.md now has a
trim-based lookup. Finding the button is solved. Reading whether the panel is open is not, and
that is the blocker: the control is a toggle, so acting blind would open it when already
collapsed. DevTools capture snippet unchanged, in BACKLOG.md.

**FIXED 2026-07-31 — card click stopped stopping the refresh loop** (`content/inlinePanel.js`).
Cause: `tabState.set('running', false)` sat inside `waitForSheet`'s callback, which is gated by
guard 3 (`!document.contains(card)`) from the uncommitted 2026-07-30 single-flight fix. While the
loop runs, `refreshNow()` makes Amazon re-render the list and detach the clicked card inside the
poll window, so the run was discarded and the stop never executed. The stop now runs
synchronously at the click, before `waitForSheet`; guard 3 still governs the render, which is all
it was meant to protect. Still exactly one stop call in the file — nothing was added at another
layer. 24 automated checks incl. a detached-card mechanism proof; browser half is TC-PANEL-2B,
not run. **Note:** the log line quoted in the bug report is a `logger.log` requiring
`DEBUG_LEVEL >= 3`, but the repo ships `DEBUG_LEVEL = 1` — it cannot appear in a stock build, so
that build had the level raised.

**Accordion leg-header colour → #CFDBFB, done 2026-07-31** (`utils/designTokens.js`, one token
value). Light mode only by construction — `nightMode.js` overrides `.ext-seg-header`'s background
with `!important`, so the token's value is never exercised in dark mode. 21 automated checks;
visual half is TC-PANEL-COLOUR-1, not run. **Known contrast regression, reported not fixed:** the
secondary text `#4A6570` (distance/duration, route arrow, chevron) drops 4.88:1 → **4.48:1**,
just under WCAG AA 4.5:1 for 11–12px text. One-line fix available (`#49646F`, 4.55:1) at
`inlinePanel.js:173/178/200` — awaiting a decision.

**⛔ BLOCKED 2026-07-31 — collapse Amazon's left filters panel on auto-refresh START.** Nothing
implemented; stopped deliberately rather than guess. This feature was built and removed once
before (CHANGELOG 2026-06-18 — three strategies, none reliable), which also removed
`CLOSE_FILTER_PANEL` from `ALLOWED_CLICK_INTENTS` and its SAFETY.md click-site section, so
re-adding it needs click-site re-authorisation. **Solved this round:** all three prior attempts
used `button[aria-label="Filter"]`, but the new capture shows the label is on an inner
`<span role="img">` — so those selectors matched nothing, which explains the failures.
**Still blocked:** no reliable way to read whether the panel is currently open. The control is a
toggle, so acting without that read would OPEN it when already collapsed. The exact DevTools
capture needed to unblock (a paste-in snippet, run once with the panel open and once collapsed)
is in BACKLOG.md.

**Sidebar paused/rate-limit message REMOVED 2026-07-31** (PM decision, `content/sidebar.js`
only). The amber "Paused — Amazon has temporarily limited your IP…" line, its "i" icon, and that
icon's tooltip are gone; nothing about the paused state renders any more. **The backoff/pause
behaviour is untouched** — `background.js` and `content/networkObserver.js` were not edited at
all, and the extension still stops polling on 429/503 and still auto-resumes. Verified with a
Node `vm` harness driving the real `background.js` and the real `buildSidebar()` (79 checks);
browser half is TC-RATELIMIT-6, not run. Two judgment calls flagged in CHANGELOG.md: the slider
no longer hides during a pause (that hiding existed only to make room for the banner), and
`renderSharedRateStatus()` was left as-is so row 2 still hides while paused. **Reinstatement
record — verbatim original code — is in BACKLOG.md**, not commented out in the source.

**✅ Spurious-pause bug FIXED 2026-07-31** (`content/networkObserver.js` + `background.js`). Was:
the paused state was entered by **any** failed or aborted `/api/loadboard/search` request, so an
ordinary saved-search switch (which aborts the in-flight request) silently stopped monitoring and
escalated through 5/10/20/40/80s while the dispatcher's board carried on looking fine. Now:
aborts are never reported (fetch checks `signal.aborted` + `err.name === 'AbortError'`; XHR
subscribes to `load`/`error`/`timeout` instead of `loadend`), and only `RATE_LIMIT_STATUSES =
[429, 502, 503, 504]` enter backoff — everything else returns without writing state, so an
in-flight backoff is neither extended nor cleared. **The backoff machinery itself is unchanged**,
proved by A/B against the committed `background.js` (identical step sequences and reset behaviour
for all four statuses). 104 automated checks pass; browser half is TC-RATELIMIT-7, not run. The
false comment at `background.js:208-212` was corrected as part of the same change.

**502/504 are a deliberate safety-side default made WITHOUT captured evidence** (PM decision,
same day). We have never observed Amazon throttling via a gateway status; they are included
because the cost is asymmetric — an un-backed-off throttle risks a real IP block on the
dispatcher's account, an ordinary gateway error costs a few seconds. Recorded at the constant in
`background.js` so it can be revisited if evidence appears. **500 stays out.**

**Open decisions still handed back (report only, CHANGELOG.md 2026-07-31):** what 500, 401/403
(recommend a gate re-check, not backoff), 404 (recommend a loud log — sustained 404s mean
`WATCH_PATH` went stale and we are blind), and status 0 (recommend leaving as-is) should each do.

**Audit finding B1 (High) — activation lockout — FIXED 2026-07-30, `content/content.js` only.**
The first of the audit's substantive findings to be fixed rather than just reported.
`_extActivated` is now set only after `tabState.init()` + `buildSidebar()` + `initManualToggle()`
have all succeeded; a throw logs `logger.error` with the failing step, rolls back through the
existing `deactivateExtensionUI()` teardown, and leaves the flag false so the next activation
retries. A separate `_extActivating` in-flight guard, cleared in a `finally`, keeps two
concurrent calls from initialising twice. Proved at the control-flow level with a Node harness
over the real source text (44 checks, all pass); **still unverified in a browser** — see
TC-AUTH-8. Two adjacent issues were found and deliberately left unfixed (logout arriving
mid-activation; the `ext-sidebar-styles` `<style>` tag never removed on teardown) — both written
up in CHANGELOG.md 2026-07-30.

**Popup opens straight into the panel, and a lost connection no longer signs anyone out —
FIXED 2026-07-30** (`popup.html` / `popup.css` / `popup.js`). Both symptoms had one cause: the
popup awaited a network round trip before deciding what to render. It now decides from the
locally stored session (same 30s expiry margin, same comparison) and renders immediately, then
validates in the background. When validation fails it distinguishes a server verdict from an
unreachable server using the Supabase bundle's own `isAuthRetryableFetchError` — unreachable
means the dispatcher stays signed in, the session is not cleared, and an inline "No connection"
note appears in the existing status line. No Supabase call, storage key, or branch condition
changed; only when results are applied. The interim "Checking your session…" state and its
3000ms timer, added earlier the same day, are removed. Proved with a Node `vm` harness running
the **real** Supabase bundle with only `fetch` swapped (51 checks); **visual/timing claims are
unverified** — see TC-AUTH-9 steps 1, 2, 6.

**Known slow path (library behaviour, unchanged):** on *expired session + offline*, gotrue's
`_refreshAccessToken` retries internally for up to `N = 30*1e3` (measured ~25.6s) before the
failure surfaces, so the "No connection" note on that one path is late. The login form still
appears instantly and the session is still not cleared. Valid-session + offline is prompt —
`setSession`/`_getUser` has no retry wrapper.

**PART B analysis (report only, nothing optimised), CHANGELOG.md 2026-07-30:** established that
`setSession()` is a real network `GET /auth/v1/user` (read out of the shipped bundle), measured
171–499ms cold; that the signed-in answer including the email is already in
`chrome.storage.local` before it runs; and that nothing is cached between popup opens. That
report is what the fix above is built on. `utils/authGate.js:37` still does the same network
validation in every content script on every page load — untouched, same opportunity.

**Follow-up report (also 2026-07-30, nothing implemented):** whether `supabase.min.js` can be
loaded after first paint. Yes in principle — first paint no longer needs it — but **not** by
moving or deferring the `<script>` tag, which would leave `supabaseClient` null and route every
dispatcher to the login form. It needs lazy client creation plus fixing five `if
(!supabaseClient)` guards that currently say "Login not configured.". And the payoff is
**inferred, not measured** — measure "Evaluate Script" for the bundle in the devtools
Performance panel before deciding it is worth the failure modes.

Otherwise nothing actively in-flight. All work above is implemented and syntax-checked but **not yet
committed to git** (see `git status`) and **not yet manually driven through a loaded-unpacked
Chrome session** — no browser available in these sessions. Everything from "Supabase login"
onward needs a real browser pass before being considered verified. See `docs/TEST_CASES.md`
TC-AUTH-1 through TC-AUTH-8, TC-PAT-CITY-1, TC-PAT-TIME-1, TC-PANEL-WIDTH-1/2,
TC-PANEL-POLISH-1, and TC-RATELIMIT-1 for exact steps.

Also this session: `docs/CLAUDE.md` gained a new "Verification rules" section (PROOF BEFORE
REPORT + the six-item SMOKE CHECKLIST) — this file's own repeated "not yet exercised in a
browser" caveats above are this session applying that rule to itself, not just documenting
it.

**Interpretive judgment call flagged for review (2026-07-30):** the "Shared refresh limit"
toggle's OFF mode was implemented as disabling only the PACING/COORDINATION step, leaving
the refresh-interval *value* itself global (unchanged from the prior task). The task's
wording ("each tab runs its own independent timer... exactly as before this change") could
also be read as reverting the interval setting's storage back to per-tab. See CHANGELOG.md
2026-07-30 entry for the full reasoning; flagged so the user can correct this if the
intent was broader.

## Що далі / Next

- **PRE-LAUNCH BLOCKER — cross-tab rate limiting must be verified in a real multi-tab
  browser session before this extension is distributed to more than one dispatcher** — see
  docs/BACKLOG.md's "🚫 PRE-LAUNCH BLOCKER" section and docs/TEST_CASES.md TC-RATELIMIT-1.
  This is the highest-priority open item.
- **Manual browser smoke-test, per the Verification rules (docs/CLAUDE.md):** OTP flow
  (send → real email → verify → 6-10 digit code → session persists across popup close/reopen
  → logout), pending-state resume, full gating (logged-out page load produces zero extension
  DOM; expired-session silent refresh; toggle-time recheck; popup shows only login block when
  logged out), live activate/deactivate on login/logout (TC-AUTH-6/7), the three audit fixes
  (TC-PAT-CITY-1, TC-PAT-TIME-1), all three inline-panel CSS passes
  (TC-PANEL-WIDTH-1/2, TC-PANEL-POLISH-1), and the new "Shared refresh limit" toggle
  (TC-RATELIMIT-2) — none of the CSS/UI work has been visually confirmed at all yet. Run
  the six-item SMOKE CHECKLIST from docs/CLAUDE.md's Verification rules section and report
  pass/fail per item.
- **TC-AUTH-8 (activation lockout, B1)** — needs a browser pass with an induced
  `buildSidebar()` throw; the recovery step (failed activation → next attempt builds a working
  sidebar) is the one that actually proves the fix.
- **TC-AUTH-9 (local-first popup render + offline handling)** — steps 1, 2 and 6 are
  browser-only. Step 3 (offline while signed in) is the one that proves nobody gets signed out
  by a dropped connection; step 6 documents the ~25–30s late message on the expired+offline
  path so it is not mistaken for a hang.
- **Decide on deferring `supabase.min.js`** — reported, not implemented (CHANGELOG.md
  2026-07-30). Measure the bundle's evaluate-script cost first; the payoff is inferred.
- **Consider the same local-first treatment for `utils/authGate.js`** — it still does a network
  `setSession()` on every page load in every content script before features can activate. Not
  analysed in depth; flagged by the popup work.
- **Decide on the two adjacent issues left unfixed by the B1 fix:** (1) logout arriving while
  activation is in flight still builds a sidebar for a logged-out session — likely wants an
  `isAuthGateActiveSync()` recheck after the await; (2) `buildSidebar()`'s injected
  `<style data-testid="ext-sidebar-styles">` is never removed by `deactivateExtensionUI()`, so
  copies accumulate across deactivate→activate cycles. Both are cheap; both were out of the
  one-fix scope.
- **A user-visible failure signal for a failed activation** — the B1 fix logs to the console
  only, by explicit instruction. A dispatcher who hits it still sees nothing on screen; they
  just get a working retry path instead of a permanent lockout. Not yet approved as a task.
- Extend the "Torren Relay" rebrand to `utils/constants.js`'s `EXT_NAME` (on-page sidebar
  title) and the manifest `description` — tracked in BACKLOG.md.
- `docs/SAFETY.md` pass for the two new surfaces introduced by rate limiting — a background
  service worker, and a MAIN-world script patching `window.fetch`/`XMLHttpRequest.prototype`
  — flagged in CHANGELOG.md 2026-07-20 but not yet written up.
- Resolve the Fast Book blocker (see below) before any further commits touch
  `utils/constants.js` or `docs/SAFETY.md`.
- Non-US locale handling (city/address formats, API response differences) — blocked until
  real captured data from a non-`.com` domain exists (see BACKLOG.md).
- Stage 15–18: performance hardening, error-handling pass, safety audit (Stage 17 checklist in
  SAFETY.md is currently incomplete/stripped — needs restoring once Fast Book is resolved),
  final build + packaging.
- Memory-leak / caching audit items 3 and 5 (style/favicon injection idempotency re-check,
  confirm no onChanged listener re-registration on SPA nav) — still open per BACKLOG.md.
- Auto-restore Amazon filters after reload — planned, not started, needs its own SAFETY.md
  review before implementation (new DOM interaction site).
- Missing PAT/inline-panel fields, reported not implemented (2026-07-20 audit): per-segment
  payout, segment ID label, stop-level warnings (e.g. Road Restriction) — absent entirely;
  segment distance/duration shown only for multi-segment loads, not single-segment ones.

## Блокери / Blockers

- **🚫 Cross-tab rate limiting unverified in a real browser (2026-07-20, PRE-LAUNCH
  BLOCKER):** code-complete and verified with real functional tests at the logic level
  (18/18 + 4/4 — see above), but genuinely untested against Amazon's real infrastructure
  with real multiple tabs. The whole point of this feature is preventing a shared-IP
  failure mode that silently breaks the extension for everyone on that IP — shipping it
  unverified risks the exact failure it's meant to prevent, just with more moving parts.
  See docs/BACKLOG.md and docs/TEST_CASES.md TC-RATELIMIT-1. The 2026-07-30 follow-up
  (TC-RATELIMIT-2) makes the shared budget optional but defaults to ON — it does not
  resolve this blocker, it only adds an escape hatch for a dispatcher who wants it off.

- **Fast Book safety reversal (unresolved, flagged 2026-07-17):** an uncommitted change in the
  working tree empties `FORBIDDEN_SELECTORS` in `utils/constants.js` (previously
  `#rlb-book-btn`, `#rlb-book-trip-confirm-booking-btn`, `#book-btn-row`), adds a new
  `ALLOWED_CLICK_INTENTS.FAST_BOOK`, and edits `docs/SAFETY.md` to change "The extension NEVER
  books a load" to "CAN execute a booking sequence" on a Fast Book trigger. This reverses the
  project's core never-books-a-load safety guarantee and is not accounted for in any approved
  spec or changelog entry. Do not commit or build on top of this until the user explicitly
  confirms intent, scope, and review process for a booking feature. See SAFETY.md "Safety
  rules → Unsure about booking safety → ASK".
