# Release Audit — 2026-08-27

**Read-only audit. No production code, and no other doc, was changed.** Every claim below was
verified against source at the line cited. Where the repository cannot answer a question, this
says so instead of inferring.

⚠ **Doc status labels were NOT trusted.** THREE disagree with the source — `PLAN.md` B1,
`PLAN.md` task 12, and the comment above `CITY_FILTER_ENABLED` — and each is called out where it
occurs.

---

## PART A — Verified from source

### A1. Debug flags — ✅ ALL CORRECT AND COMMITTED

| flag | file:line | value |
|---|---|---|
| `DEBUG_LEVEL` | `utils/constants.js:42` | **`1`** — the shipped default (error only) |
| `CITY_ASSIGN_DEBUG` | `utils/constants.js:84` | **`false`** |
| `CITY_ASSIGN_DEBUG` (MAIN mirror) | `content/networkObserver.js:51` | **`false`** — ✅ agrees |
| `CAPTURE_RESPONSES` | `utils/constants.js:62` | `false` |
| `CAPTURE_RESPONSES` (MAIN mirror) | `content/networkObserver.js:39` | `false` — ✅ agrees |

**Ihor's flip is confirmed AND committed** — `git log` puts `utils/constants.js` at **a01edac**,
and `git show HEAD:utils/constants.js` reads `1` / `false` / `false`. The working tree shows no
modification to that file.

**`capture-suite`: PASS 72, FAIL 0.** Whole regression: **2563 pass, 0 fail, 0 crashed**, 44 suites.

🔑 **The shipped path still reads response bodies, and that is correct, not a leftover.**
`bodyCaptureNeeded()` at `content/networkObserver.js:66-68` returns
`CITY_FILTER_ENABLED || CAPTURE_RESPONSES`, so the city filter gets its coordinates with both
debug flags off. Only the id + pickup lat/lng cross `postMessage` on that path.

> ⚠ **TWO STALE DOC CLAIMS.** `PLAN.md` **B1** says the flag change is *"UNCOMMITTED, so the
> history at b1b4c96 still builds a debug extension"* — **false**, it was committed at a01edac.
> `PLAN.md` **task 12** says *"`DEBUG_LEVEL` is currently `3` and must return to `1`"* — **false**,
> it is `1`. **B1 and PLAN 12 are done; the docs never caught up.**

### A2. `CITY_FILTER_ENABLED` — value right, comment wrong

- **`utils/constants.js:108` — `const CITY_FILTER_ENABLED = true;`** ✅ correct for shipping.
- ❌ **The stale comment is NOT fixed.** `utils/constants.js:87` still reads
  *"FEATURE SWITCH — per-city card filtering (2026-08-13). **Shipped OFF**."* directly above a
  constant that is `true`. The MAIN mirror at `content/networkObserver.js:64` is `true` and its
  comment is correct.

Cosmetic, but it is the one flag that changes what the dispatcher sees, and its comment currently
states the opposite of its value.

### A3. Manifest — icons, permissions

> ✅ **UPDATED 2026-08-27, AFTER this audit was written.** The permission items below are now
> CLOSED — see BACKLOG 0am. `manifest.json` reads `"permissions": ["storage", "clipboardWrite"]`.
> **The icon findings are unchanged and still block submission.**

| item | status | evidence |
|---|---|---|
| `icons` key | ✅ **ADDED 2026-09-02** | all four sizes → `icons/icon<N>.png`, every file verified present |
| `action.default_icon` | ✅ **ADDED 2026-09-02** | added to the existing `action`; `default_title`/`default_popup` preserved |
| PNG files in repo | ⚠ **PRESENT but UNTRACKED** | four PNGs in `icons/`, all byte-identical 128×128 copies; `git ls-files icons/` returns **0** — `git add icons/` still needed |
| `scripting` permission | ✅ **REMOVED 2026-08-27** | was `manifest.json:7`; permissions are now `["storage", "clipboardWrite"]` |
| `chrome.scripting` uses | ✅ **STILL ZERO** | `grep -rn "chrome\.scripting"` → no matches in any file |

**`activeTab` — ✅ REMOVED 2026-08-27.** *Resolved after this audit: the complete `chrome.*`
surface is `storage.local`, `storage.onChanged`, `runtime.sendMessage`, `runtime.onMessage`,
`tabs.onRemoved` — none of the APIs `activeTab` unlocks is present. ⚠ `activeTabsQueueTail` and
`_activeTabCount` are unrelated bookkeeping, not uses. See BACKLOG 0am.* Original finding: Nothing in the
repository calls an API that requires it. The only `chrome.tabs` use is
`chrome.tabs.onRemoved` (`background.js:235`), which fires **without** any tabs permission, and
page access already comes from `host_permissions`. **Source suggests it is removable, but removal
should be confirmed with one live run**, not on this reading alone.

**`clipboardWrite` — ✅ KEPT 2026-08-27,** precisely because it is unproven: the write sits **two
async hops** past its gesture (click → `html2canvas().then()` → `toBlob(cb)` → `clipboard.write()`),
and a wrong removal breaks Copy Screenshot with only a `logger.error`. See BACKLOG 0am. Original
finding: The clipboard
call is `navigator.clipboard.write` (`content/inlinePanel.js:738`), and
`content/inlinePanel.js:723` asserts it works *"when clipboardWrite is granted"*. ⚠ **That
comment is an assumption, not a measurement.** The manifest `clipboardWrite` permission governs
`document.execCommand('copy')` in extension pages; `navigator.clipboard.write` from a content
script is gated by transient user activation instead. **Only a live test with the permission
removed can settle it.** Source cannot.

### A4. Name and description

- ✅ **`EXT_NAME` is NOT `'Amazon Relay Helper'` any more** — `utils/constants.js:25` reads
  **`'Tenlane Relay'`**, matching `manifest.json:3`. That premise is out of date.
- ✅ **REWRITTEN 2026-09-02 (Ihor's wording).** `manifest.json:5` now reads *"Monitors the Amazon
  Relay load board, alerts you to new loads, filters by origin city, and streamlines your dispatch
  workflow."* — **126 chars**, within the 132 limit. ⚠ **The mismatch that made this a blocker is
  gone for two independent reasons:** the description no longer makes any claim about booking,
  **and** Fast Book is gated off by `FAST_BOOK_ENABLED = false`. 🔑 **Neither the listing nor the
  privacy policy now depends on a booking claim** — but the internal safety rule in
  `MVP_SPECIFICATION.md` ("does NOT book loads. Ever.") is untouched and still governs
  `FORBIDDEN_SELECTORS`, the click intents and the Fast Book gate.

### A5. Version

`manifest.json:4` — **`"version": "0.1.0"`**. Valid for the store; it is a decision, not a defect,
whether a public 1.0 launch ships as `0.1.0`.

---

## PART B — Everything not done

Judged **by consequence to a dispatcher**, not by age. Three verdicts only.

### 🔴 BLOCKS RELEASE

| id | what it is | why it blocks |
|---|---|---|
| **PKG-1** | ⚠ **`utils/supabaseConfig.js` is REQUIRED by the manifest but NOT COMMITTED** — `.gitignore:8`; `git ls-files` lists only `supabaseConfig.example.js` | The manifest loads it as content script #5 (`manifest.json:47`). **A zip built from a clean checkout is missing it and the extension breaks on load.** It exists only on this machine. |
| **0ad / PLAN 21** | The search radius is a **bare number with no unit**; `radiusUnitCaveat()` (`cityAssign.js:2226`) warns on a non-`.com` host | 🔑 **The manifest ships to TEN non-US Relay domains** — eleven in total with `.com` (`.ca .co.jp .co.uk .cz .de .es .fr .it .in .pl`, `manifest.json:9-19`, mirrored in `content_scripts.matches`). On a metric board the number is read as miles and the filter is wrong. ⚠ **AND THE WARNING IS INVISIBLE IN A SHIPPED BUILD** — all three call sites (`:2009`, `:2075`, `:3173`) are `logger.log`, which `DEBUG_LEVEL = 1` silences. **Either narrow the manifest to `.com` or get one non-`.com` capture.** |
| **PLAN 11** | Full manual smoke pass — **never run for this entire phase** | Nothing built since 2026-08-20 has been seen working end to end. See Part C. |
| **UNCOMMITTED** | `content/inlinePanel.js` — today's Fast Book fix is in the working tree only | `git status` shows it modified. **Without this commit the build still has Fast Book blocked on every press.** Five docs are likewise uncommitted. |

⚠ **One more, conditional on Fast Book being switched on:**

| id | what it is | why |
|---|---|---|
| **SAFETY-1** | **`FORBIDDEN_SELECTORS` is an EMPTY ARRAY** (`utils/constants.js:1-2`), so `isForbiddenElement()` (`:4-7`) **always returns `false`** | The "never books a load" guard is fully disarmed. ✅ **Mitigation, verified:** Fast Book ships **OFF** — `popup/popup.js:29` documents `default false` and `:487` requires `=== true`. So this is inert until the dispatcher opts in. **It blocks release only if Fast Book is meant to be usable in 1.0.** That is Ihor's call and the docs do not record the decision to empty this array. |
| **0al** teardown asymmetry | `showInlinePanel()` removes a replaced panel with `old.remove()` (`inlinePanel.js:1360`) instead of `removeInlinePanel()`, so the confirm poll survives a panel **replacement** | A poll that **clicks a confirm button** can outlive the panel it belongs to. Partly mitigated — `executeFastBook()` cancels any live poll when it starts, closing the two-polls-racing case. Residual: press Fast Book, then click another card within 5 s. **Same condition: matters only with Fast Book on.** |

### 🟡 SHIP WITH A STATED LIMITATION

| id | what it is | the limitation to state |
|---|---|---|
| **0aj** | Auto-open re-scroll — **FIXED 2026-08-27**, `rescrollOpenedCard()` in `detailOpener.js` | Fixed but **never seen working**. Worst case: the dispatcher scrolls manually, as today. |
| **0al** SPA question | Does Amazon swap the sheet's content in place, same element, different load? | **Not knowable from this repository.** The identity guard is correct either way; only how often it fires is unknown. |
| **PLAN 8** 40′ Container | `FORTY_FOOT_CONTAINER` is in `patApi.js:26` but **deliberately unmapped** (`patModal.js:439`) | ✅ **Fails safe** — an unmapped enum is logged verbatim and routed to the unsupported-equipment modal. PAT refuses to post rather than posting wrong. |
| **0p** R-type detection | Trailer ownership read from the card's **badge letter** (`cityAssign.js:203`, `loadParser.js:219`) — an authorised interim DOM dependency | ✅ **PLAN 8 records Ihor confirming a real R post and a real P post live.** The limitation is the DOM coupling, not the correctness. |
| **0k** `["LIVE","DROP"]` | For a `"Live/Drop"` load PAT now posts `["DROP"]`, not `["LIVE","DROP"]`; and a `"LTL/Live/Drop"` load **now posts where it used to refuse** | Needs one word from Ihor. Nothing on disk answers it — captures only ever show `["LIVE"]` **or** `["DROP"]`. Consequence is a truck posting, not a booking. |
| **PLAN 20** price-increase capture | Payout selector for a price-increased card is unknown | On a surged card the panel shows a "could not be read" warning instead of the payout. Visible, not silent. |
| **0o** `normalizeState()` | `patApi.js:134` still ends `|| s.toUpperCase().slice(0, 2)` — `"PENNSYLVANIA"` → `"PE"` | Silently posts an invalid state code for any full name missing from `STATE_NAME_TO_CODE`. Low frequency, silent failure. ⚠ Note `cityAssign`'s separate `normalizeStopState()` **does** refuse unknown names — the two disagree. |
| **0b / 0e** dedupe | `readMainCardElements()` (`cityAssign.js:1211-1230`) has **no dedupe** — every UUID-shaped `div[id]` is pushed | A card counted twice skews per-city counts and badge numbers. Never hides a card, so it cannot lose a load. |

### 🔵 AFTER 1.0

| id | what it is |
|---|---|
| **night-mode zebra** | `nightMode.js` keeps a dark alternating-row fill after the light one was removed. **Blocked by the standing "do not edit nightMode.js" rule** — removable on Ihor's word. |
| **gateStillOpen() orphan** | `content/content.js:323`, **one occurrence in the whole repo — defined, never called.** Already labelled *"⚠ ORPHANED BY STAGE A (2026-08-14)"* at `:317` and kept deliberately. Dead code, zero runtime effect. |
| **ext-sidebar-styles leak** | `sidebar.js:13` sets the testid; **the string appears nowhere else in the repo** — nothing removes the `<style>`. Repeated login→logout cycles accumulate elements. |
| **0ak** surge sound | Surge and new-load both call the same `playAlert()` (`priceSurge.js:146`); a dispatcher cannot tell them apart by ear. BACKLOG already marks it **1.1**. |
| **PLAN 19** filters panel | Collapse on START — blocked on a reliable read of open vs collapsed. |
| **PLAN 29f** panel fields | Cost breakdown, `specialServices`, layover, per-stop instructions, deadhead, arrival windows. Each needs a projection field *and* a render slot. Pure addition. |
| **BACKLOG 3** surge filter awareness | The surge path can auto-open a card the active city filter has hidden. |
| ~~**A2 comment**~~ | ✅ **FIXED 2026-08-27** — now reads "PRODUCT FLAG — SHIPPED ON" and cites HANDOFF rule 11. Value untouched. |
| **0aa** | Panel does not render on a 2208px-wide card. Already marked deferred. |
| **0s** | Shared cross-tab refresh limit — intact, unreachable, one constant re-enables it. |
| PLAN 16, 17, 18, 22–28 | Tuning, caching, file splits, memory audit, status handling, SAFETY.md pass. |

**Nothing on the required list was found already-done except B1 and PLAN 12** (Part A1), which are
closed by commit a01edac and are simply mislabelled in `PLAN.md`.

---

## PART C — What only Ihor can close

Ordered by what would hurt most if wrong. **His recent live confirmations are excluded**:
auto-open renders the panel, the surge badge appears, and the Fast Book dry run clears both gates
on a matching load.

1. 🔴 **A real Fast Book booking, end to end.** The dry run returns *before* both clicks
   (`inlinePanel.js:558` precedes `:562` and `:614`). **The two real clicks and the confirm poll
   have never executed.** Only a genuine booking covers them — and it spends money on a real load.
2. 🔴 **The six-item smoke pass (PLAN 11).** Popup opens clean · logged-out popup shows only login
   · full login flow · sidebar activates · PAT modal Confirm enables · **no page-console errors**.
   Never run since 2026-08-13.
3. 🔴 **One non-`.com` board**, or the decision to ship US-only. Settles B5/0ad — the largest
   silent-wrongness risk in the product, and the manifest currently claims eleven such domains.
4. 🟠 **The city filter against his own eyes** (PLAN 6, 7, 7c, 7e, 7f — all *"awaiting live
   confirmation"* since 2026-08-13). Per-city counts match a hand count; a click filters and
   clicking again returns All; a 3-page board filters correctly per page.
5. 🟠 **`0aj` re-scroll** — several auto-opens in a row, **foreground and background**, landing in
   view without the wheel.
6. 🟠 **`0k`** — for a `"Live/Drop"` load, should PAT post `["LIVE","DROP"]` or `["DROP"]`?
7. 🟡 **The Amazon-SPA question (0al)** — leave the sheet open through a refresh and watch whether
   the selected card's UUID changes while the sheet element persists.
8. 🟡 **Whether `activeTab` and `clipboardWrite` can be dropped** — remove them, reload, and
   confirm the camera button still copies.

---

## PART D — The answer

**No. This cannot be submitted today**, and the reasons are packaging and listing, not the
codebase: the extension is functionally in good shape — 2563 tests green across 44 suites, all
debug flags at ship values and committed, no `eval` or remote code anywhere — but **a zip built
from the repository right now would not run**, because `utils/supabaseConfig.js` is gitignored
while the manifest loads it. On top of that the store will reject the package outright for having
no icon, and the description tells both the reviewer and the user that the extension *"does NOT
book loads"* while Fast Book clicks Amazon's Book and Confirm buttons. None of these is deep
work — the shortest path is roughly a day, most of it listing material rather than code, and the
one genuine product decision in the way is whether to ship to the eleven non-US domains the
manifest currently claims without ever having read a metric radius.

### The shortest ordered path to a submittable zip

1. **Commit the working tree** — `content/inlinePanel.js` (Fast Book unblocked) plus the five docs.
2. **Decide Fast Book's 1.0 status.** If it ships usable: repopulate `FORBIDDEN_SELECTORS` or
   record why it is empty, and fix the 0al teardown asymmetry. If it stays default-off, state that.
3. **Add icons** 16/32/48/128, declare `icons` **and** `action.default_icon`.
4. ~~**Remove `scripting`.**~~ ✅ **DONE 2026-08-27** — `scripting` and `activeTab` removed,
   `clipboardWrite` kept with stated evidence (BACKLOG 0am). **Still needs the two live checks:**
   the popup opens clean, and Copy Screenshot still copies.
5. **Rewrite the description** so it is true — it must say the extension can book on the
   dispatcher's explicit action.
6. **Settle the locale question** — narrow `matches`/`host_permissions` to `.com` (dropping ten
   domains), or capture a metric board. If shipping wide anyway, make `radiusUnitCaveat()` reach the user; today it is
   `logger.log` and `DEBUG_LEVEL = 1` silences it.
7. **Solve the credentials problem.** `utils/supabaseConfig.js` must be in the zip. Either commit
   it or add a documented build step. ⚠ **The anon key ships readable to anyone who unzips the
   extension** — that is normal for Supabase *only if row-level security is enforced server-side.*
   **This repository cannot tell whether RLS is on. Verify it before publishing.**
8. **Bump the version** (`0.1.0` → whatever 1.0 should be).
9. **Run the PLAN 11 smoke pass** on the packaged build, loaded unpacked from the zip's contents.

### Packaging — the zip contents (in no MD file today)

**Exclude:** `samples/` (1.4 MB, already gitignored) · `docs/` (1.2 MB) · every `*-suite.mjs`
(they live in the scratchpad, **not** in the repo — verified, so nothing to strip, but keep it
that way) · `node_modules/` (absent) · `.git/` · `.claude/` · the root `*.md` files
(`README.md`, `STATE.md`, `AMAZON_DOM_REFERENCE.md`, `MVP_SPECIFICATION.md`,
`VISUAL_CONTEXT.md`, `DESIGN_TOKENS.md`) · `design-mockup.html` · **`temporary design files/`**
and **`тимчасові файли/`** (the latter contains load-text scratch files) ·
`utils/supabaseConfig.example.js`.

**Include:** `manifest.json`, `background.js`, `content/`, `utils/` (**with the real
`supabaseConfig.js`**), `popup/`, `vendor/`, and the new `icons/`.

> ✅ **AUTOMATED 2026-09-02 — `scripts/build-zip.mjs`.** The list above is no longer applied by
> hand: the script derives it from `manifest.json` and from every HTML page the manifest
> references, refuses to build if any referenced path is missing, and verifies the finished
> archive by reading it back (manifest at root, forward slashes, every file present, no excluded
> path inside). **41 files, 416.2 KB, all assertions passed.**

⚠ **Zip the CONTENTS, not the folder** — `manifest.json` must sit at the archive root.

⚠ **`vendor/` carries two minified libraries** — `html2canvas.min.js` (194 KB) and
`supabase.min.js` (203 KB). Review may ask for their provenance or unminified sources; have the
versions and origins ready.

### Listing requirements — none of these exist yet

- 🟠 **A privacy policy URL.** ✅ **TEXT DRAFTED 2026-09-02** — `docs/PRIVACY_POLICY.md`, every
  claim verified against source (two undisclosed items found and added: the Google Maps route
  button and the `supabase.co` host permission). ⚠ **STILL OPEN: it must be HOSTED.** A file in
  the repo is not a URL, and the store requires a publicly reachable address.
- ✅ **A data-use disclosure** — **WRITTEN 2026-09-02**, `docs/STORE_LISTING.md` §5: the data-type
  table, all three certifications, and the two mismatches flagged (the policy URL 404'd at the time
  — **since resolved, see below**; the
  Google Maps route button has no obvious form slot and needs a free-text line).
- ✅ **A single-purpose statement** — **WRITTEN 2026-09-02**, `docs/STORE_LISTING.md` §1, with a
  table mapping every shipped feature to the stated purpose. ⚠ Booking is no longer part of the
  surface (Fast Book is gated off), which narrows it usefully. **Post-a-Truck remains the weakest
  fit and the answer to a challenge is written out.**
- 🟠 **Screenshots** (1280×800) — **SHOT LIST WRITTEN 2026-09-02**, `docs/STORE_LISTING.md` §6:
  four required shots plus one optional, each with what must and must NOT be on screen (no carrier
  name, no account email, no Fast Book button, no bookmarks bar). ⚠ **Still to be captured.**
- 🟠 **Reviewer test credentials** — **NOTES BLOCK WRITTEN 2026-09-02**, `docs/STORE_LISTING.md`
  §7, with a marked placeholder for the account Ihor creates. ⚠ **Still to be created.** 🔑 **This is the one most likely to sink a first submission.**
  The extension only activates behind a login (`isAuthGateActiveSync`, `utils/authGate.js:107`)
  **and** only on `relay.amazon.*` — a reviewer has neither an Amazon Relay carrier account nor a
  Tenlane login. **Without a working test account and step-by-step instructions in the reviewer
  notes, they will see a page that does nothing and reject it.** Plan for a demo account, and
  expect to explain the Amazon dependency explicitly.

---

*Audit only. Nothing here was fixed, and no other document was edited. What gets done, and in
what order, is Ihor's decision.*


---

# FINAL PRE-SUBMISSION VERIFICATION — 2026-09-02

**Read-only. No production code was changed.** Everything below was checked against
`dist/tenlane-relay-1.0.0.zip` and the repository — **not against any MD file's claims**, including
this document's own earlier sections.

**Mechanically verified here:** items 1, 2, 3 and 4 in full. **Depends on Ihor:** every item in §5
marked *live*, and the single smoke test in §6 — the archive is complete *by assertion*, and has
never been loaded in a browser.

---

## 1. The archive — ✅ ALL CHECKS PASS

| check | result |
|---|---|
| `manifest.json` at the archive ROOT | ✅ present, no wrapper folder |
| valid JSON, `version` | ✅ parses; **1.0.0** |
| entry-name separators | ✅ forward slashes throughout |
| `icons` block, all four sizes | ✅ present, every path inside the archive |
| `action.default_icon`, all four sizes | ✅ present, same four paths |
| every icon a real PNG (file signature) | ✅ `89504e470d0a1a0a` on all four |
| every manifest-referenced file inside | ✅ **39/39** |
| excluded paths leaked in | ✅ **none** — no `samples/`, `docs/`, `node_modules/`, `.git/`, `*-suite.mjs`, `scripts/`, `dist/`, root `*.md`, `.gitignore`, and neither stray temp folder |

**Size: 41 files · 416.2 KB zipped (426,188 bytes) · 1343.1 KB uncompressed (1,375,313 bytes).**

✅ **The icons are now correctly sized** — 16×16, 32×32, 48×48, 128×128, four distinct files
(md5s `ef5a3739` / `9ea5a45c` / `380ee703` / `eb0f2df8`). The earlier finding that all four were
byte-identical copies of the 128px image **is resolved.**

---

## 2. Shipping values — ✅ NO MISMATCH ANYWHERE

Checked in **three** places, because the archive was built from the working tree rather than from
`HEAD`: the committed value (`git show HEAD:`), the working tree, and **the file as it exists
inside the zip**.

| constant | HEAD | worktree | in archive | expected | file:line |
|---|---|---|---|---|---|
| `DEBUG_LEVEL` | 1 | 1 | 1 | 1 | `utils/constants.js:42` |
| `CITY_ASSIGN_DEBUG` | false | false | false | false | `utils/constants.js:84` |
| `CITY_ASSIGN_DEBUG` *(MAIN mirror)* | false | false | false | false | `content/networkObserver.js:51` |
| `CAPTURE_RESPONSES` | false | false | false | false | `utils/constants.js:62` |
| `CAPTURE_RESPONSES` *(MAIN mirror)* | false | false | false | false | `content/networkObserver.js:39` |
| `CITY_FILTER_ENABLED` | true | true | true | true | `utils/constants.js:118` |
| `CITY_FILTER_ENABLED` *(MAIN mirror)* | true | true | true | true | `content/networkObserver.js:64` |
| `FAST_BOOK_ENABLED` | false | false | false | false | `utils/constants.js:144` |

🔑 **All three mirrors agree with their constants. Zero mismatches.** All eight values are
committed — the archive does not ship anything uncommitted in these files.

---

## 3. What the dispatcher sees at stock level — ✅ QUIET

At `DEBUG_LEVEL = 1` the logger emits **`logger.error` only**; `log`, `warn` and `debug` are
suppressed (`utils/logger.js:36-40`). So stock-level output is: ungated `console.*` calls, plus
`logger.error`.

### Prints automatically — and each is deliberate

| file:line | fires when | kept because |
|---|---|---|
| `utils/constants.js:262` | the extension declines to activate on a Relay page | the page gate must not fail silently. **Deduped per path; never fires on the load board.** |
| `content/cityAssign.js:2205` | a city's search radius could not be read | the dispatcher must know his radius was not used |
| `content/cityAssign.js:3573` | the `/search` request body could not be read at all | same reason |
| `background.js:308` | a request fails with a **non**-rate-limit status | ⚠ **the only unintended one.** A plain `console.log` in the **service-worker** console, not the page. Fires only on a genuine failure that is not 429/502/503/504, so **not a stream** — a reviewer sees it only if Amazon errors, and only if they open the service worker. **Left as-is; noted.** |

### Confirmed NOT to print in normal operation

- **All 8 `executeFastBook` error sites** (`inlinePanel.js:419`–`:634`) — unreachable: gate 3
  returns at function entry while `FAST_BOOK_ENABLED` is false.
- **All 3 `sheetOpenLoadId` error sites** (`:1847`, `:1872`, `:1881`) — its only callers are
  `executeFastBook` (unreachable), `fastBookDryRun` (manual, returns early when disabled), and
  `clickDiagSheetLoadId`, whose callers sit inside the `CITY_ASSIGN_DEBUG` diagnostics.
- **Both `detailOpener` "BLOCKED: forbidden element" errors** (`:207`, `:328`) — `FORBIDDEN_SELECTORS`
  is an empty array (`utils/constants.js:1-2`), so `isForbiddenElement()` always returns false and
  neither branch is reachable. *(Recorded separately as a safety finding — see §5.)*
- **Every `__EXT_DEBUG` printout** — reachable only by typing the helper name in the console.
- `cityAssign.js:3544` — gated on `cityVerboseDiagnostics()` → `CITY_ASSIGN_DEBUG`, false.

🔑 **On a clean load of the board, the console shows nothing from this extension.**

---

## 4. `__EXT_DEBUG` surface — 39 helpers

⚠ **All 39 are registered unconditionally** — they are not behind `CITY_ASSIGN_DEBUG`. They are
inert unless typed into the console, but they are enumerable by anyone who opens DevTools.

### 🔑 Can any of them book, post, or click Amazon's Book button?

| helper | verdict |
|---|---|
| `fastBookDryRun` | ✅ **CANNOT.** Returns `{disabled:true}` at entry (`inlinePanel.js:2307`) while the flag is false. Even if it proceeded, it passes `dryRun=true` and returns before both click sites. |
| `fastBookForceMismatch` | ✅ **CANNOT.** Returns `false` at entry (`inlinePanel.js:2398`); arms nothing. |
| `openPostModal` | ⚠ **Opens the PAT form; does NOT submit.** `submitOrder()` is reached only from the Confirm button inside the modal (`patModal.js:1657`). A reviewer would have to fill the form and press Confirm deliberately. |

**Helpers that do click Amazon elements — both are the extension's ordinary, advertised actions:**
`openTopNew` (opens a load card, same as a user click) and `refreshNow` (presses Amazon's own
refresh button). Neither books.

**The remaining 34** act only on our own UI, our own state, or are read-only: `memReport`,
`pageGate`, `cityAssignments`, `getLoads`, `getSearchRequest`, `getSearchRequestIssue`,
`dumpSearchRequest`, `dumpTrailerLabels`, `dumpAutoOpenDiag`, `getEquipmentEnumMap`,
`getSeenEquipmentTypes`, `rateDiag`/`rateDiagOn`/`rateDiagOff`/`rateDiagClear`,
`simulateRateLimit`, `simulateRecovery`, `simulateSurge`, `surgeCandidates`, `filterCity`,
`showPanel`, `removePanel`, `removePatModal`, `highlightNew`, `clearHighlights`,
`recomputeTagHiding`, `toggleNight`, `toggleHideSimilar`, `playAlert`, `flashTabAlert`,
`stopTabAlert`, `detectNewLoads`, `resetKnownLoads`, `findRefreshButton`, `refreshDryRun`,
`initManualToggle`.

---

## 5. Residual risk list — **could a reviewer hit it in a few minutes?**

| risk | reviewer-visible in minutes? |
|---|---|
| Radius unit on non-`.com` domains | ❌ **No.** Needs a non-`.com` Relay carrier account. |
| P/R detection is a DOM dependency; **the R branch has never executed** | ❌ **No.** Needs PAT opened on an R-badge load. |
| `FORTY_FOOT_CONTAINER` and `FIFTY_THREE_FOOT_REEFER_TRUCK` unmapped | ❌ **No** — and it fails safe: routed to the unsupported-equipment modal, never posted wrong. |
| `_cityNoCoordIds` / `_cityCoordCache` unbounded within a session | ❌ **No.** Growth over hours; invisible in minutes. |
| `ext-sidebar-styles` accumulates one `<style>` per logout→login | ❌ **No.** ~11 KB, invisible; needs a login cycle to occur at all. |
| PAT drag listeners removed lazily (next mouseup after close) | ❌ **No.** Invisible, self-healing. |
| `gateStillOpen()` orphaned (`content.js:323`) | ❌ **No.** Dead code, zero runtime effect. |
| `readMainCardElements()` has no dedupe | ⚠ **Marginally.** A card with two UUID-shaped `div[id]`s would be counted twice, and per-city counts are **on screen**. Never hides a load. The only item here with a visible surface. |
| `normalizeState()` truncation in the PAT path (`patApi.js:134`) | ❌ **No.** Needs PAT on a load whose state arrives as a full name outside the lookup. |
| Night-mode zebra striping in the panel | ⚠ **Yes, if they toggle night mode.** Purely cosmetic — alternating row fill that light mode no longer has. |
| ⚠ **`FORBIDDEN_SELECTORS` is an empty array** (`utils/constants.js:1-2`) | ❌ Not visible — but recorded because it means the "never books a load" guard is **disarmed**. **Inert in this build:** Fast Book is gated off three ways, and no other code path clicks a booking control. **It must be repopulated before `FAST_BOOK_ENABLED` is ever flipped true.** |

**Only two have any chance of being noticed, and both are cosmetic.**

---

## 6. VERDICT

**The package itself is submittable. The submission is not, and the gap is entirely outside the
code.** Every mechanical check passes: the archive is well-formed with `manifest.json` at its
root, all 39 manifest-referenced files present and no excluded path leaked in, all four icons
correctly sized and real PNGs, all eight shipping constants correct and in agreement across
`HEAD`, the working tree and the archive itself, a console that is silent in normal operation, and
a debug surface on which **nothing can book or post without a deliberate human click**. What
stands in the way is not the build:

1. ✅ **CLOSED — the privacy policy is published AND its content verified.** Live at
   `https://iter-tech.github.io/torren-relay/`. **Ihor opened the page on 2026-09-03 and
   confirmed it renders the policy text, not a README.** The earlier "reachability verified,
   content not" caveat is withdrawn.
2. ✅ **CLOSED — the reviewer test account exists and works.** `torrenrelayreview@proton.me`;
   sign-in verified live on 2026-09-03 — the one-time code arrives, sign-in completes, and the
   panel works on the load board. The address is now in `docs/STORE_LISTING.md` §7.
   ⚠ **The mailbox password deliberately does NOT appear in this repository, in any file or in
   any form.** Ihor types it into the store form himself.
3. 🔴 **OPEN — screenshots must be captured.** The shot list is written (`docs/STORE_LISTING.md`
   §6); the images are not taken.
4. 🟠 **OPEN — the build must be loaded once in a clean Chrome profile** and the login flow
   completed. ⚠ **This is the only proof that `utils/supabaseConfig.js` is genuinely inside the
   package and working** — it is the one file whose absence has broken this project before, and
   no assertion here can substitute for one successful sign-in.
5. ✅ **CLOSED — a reviewer walkthrough video exists.** `https://youtu.be/m1KnIF77u1g` (Unlisted),
   showing sign-in and the extension working on a real load board. 🔑 **This is the strongest
   available answer to the likeliest rejection** — that a reviewer cannot obtain an Amazon Relay
   carrier account and so cannot see the load board at all. **Link it in the store form's reviewer
   notes up front, and in any rejection reply.**

⚠ **NOT SUBMITTED.** Beyond items 3 and 4, the store form itself remains: the developer fee, the
listing fields, uploading the zip, and pressing Submit. Nothing has been sent to Google.

⚠ **Two things this audit could NOT verify and that no amount of static checking will:** that the
extension actually runs when loaded, and that sign-in succeeds from the packaged build. Items 1–3
are a morning's work; item 4 is ten minutes.
