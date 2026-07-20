# Project State

Last updated: 2026-07-20

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
(per-tab pub/sub store: running, refreshIntervalMs, surgeThreshold, priceHistory);
`content/refreshManager.js`, `loadParser.js`, `loadDetector.js`, `highlighter.js`,
`detailOpener.js`, `inlinePanel.js`, `sidebar.js`, `loadObserver.js` (MutationObserver instant
detection), `panelCloser.js`, `content.js` (orchestrator).

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

## Що в роботі / In progress

Nothing actively in-flight. All work above is implemented and syntax-checked but **not yet
committed to git** (see `git status`) and **not yet manually driven through a loaded-unpacked
Chrome session** — no browser available in these sessions. Everything from "Supabase login"
onward, plus the PAT markup change and the live activate/deactivate feature, needs a real
browser pass before being considered verified. See `docs/TEST_CASES.md` TC-AUTH-1
through TC-AUTH-6 and the PAT payout test cases for exact steps.

Also this session: `docs/CLAUDE.md` gained a new "Verification rules" section (PROOF BEFORE
REPORT + the six-item SMOKE CHECKLIST) — this file's own repeated "not yet exercised in a
browser" caveats above are this session applying that rule to itself, not just documenting
it.

## Що далі / Next

- **Manual browser smoke-test, per the new Verification rules (docs/CLAUDE.md):** OTP flow
  (send → real email → verify → 6-10 digit code → session persists across popup close/reopen
  → logout), pending-state resume, full gating (logged-out page load produces zero extension
  DOM; expired-session silent refresh; toggle-time recheck; popup shows only login block when
  logged out), PAT modal markup math (10% + missing-payout warning/Confirm-disable), and —
  highest priority, entirely unexercised — **live activate/deactivate on login/logout without
  reload** (docs/TEST_CASES.md TC-AUTH-6). Run the six-item SMOKE CHECKLIST from
  docs/CLAUDE.md's Verification rules section and report pass/fail per item.
- Extend the "Torren Relay" rebrand to `utils/constants.js`'s `EXT_NAME` (on-page sidebar
  title) and the manifest `description` — tracked in BACKLOG.md.
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

## Блокери / Blockers

- **Fast Book safety reversal (unresolved, flagged 2026-07-17):** an uncommitted change in the
  working tree empties `FORBIDDEN_SELECTORS` in `utils/constants.js` (previously
  `#rlb-book-btn`, `#rlb-book-trip-confirm-booking-btn`, `#book-btn-row`), adds a new
  `ALLOWED_CLICK_INTENTS.FAST_BOOK`, and edits `docs/SAFETY.md` to change "The extension NEVER
  books a load" to "CAN execute a booking sequence" on a Fast Book trigger. This reverses the
  project's core never-books-a-load safety guarantee and is not accounted for in any approved
  spec or changelog entry. Do not commit or build on top of this until the user explicitly
  confirms intent, scope, and review process for a booking feature. See SAFETY.md "Safety
  rules → Unsure about booking safety → ASK".
