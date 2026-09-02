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
| `icons` key | ❌ **ABSENT** | not present anywhere in `manifest.json` |
| `action.default_icon` | ❌ **ABSENT** | `manifest.json:97-99` — `action` has only `default_title` and `default_popup` |
| PNG files in repo | ❌ **NONE** | no `icons/` directory; `find . -name "*.png"` returns nothing |
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
  **`'Torren Relay'`**, matching `manifest.json:3`. That premise is out of date.
- ⚠ **The description is the ORIGINAL and it is now FACTUALLY WRONG.** `manifest.json:5`:
  *"Monitors Amazon Relay Load Board for new loads. **Does NOT book loads**."*
  **Fast Book books loads.** It clicks Amazon's Book button (`content/inlinePanel.js:562`) and its
  confirm button (`:614`). This must be rewritten before submission — see Part D.

### A5. Version

`manifest.json:4` — **`"version": "0.1.0"`**. Valid for the store; it is a decision, not a defect,
whether a public 1.0 launch ships as `0.1.0`.

---

## PART B — Everything not done

Judged **by consequence to a dispatcher**, not by age. Three verdicts only.

### 🔴 BLOCKS RELEASE

| id | what it is | why it blocks |
|---|---|---|
| **B2** | No `icons`, no `action.default_icon`, no PNG in repo (`manifest.json:97`) | **The Chrome Web Store requires a 128×128 icon.** Submission is rejected without it. |
| **PKG-1** | ⚠ **`utils/supabaseConfig.js` is REQUIRED by the manifest but NOT COMMITTED** — `.gitignore:8`; `git ls-files` lists only `supabaseConfig.example.js` | The manifest loads it as content script #5 (`manifest.json:47`). **A zip built from a clean checkout is missing it and the extension breaks on load.** It exists only on this machine. |
| **DESC** | `manifest.json:5` says *"Does NOT book loads"* while Fast Book books loads (`inlinePanel.js:562`, `:614`) | A false statement in the listing, to both the reviewer and the user. **CWS treats description/behaviour mismatch as a policy violation.** |
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

⚠ **Zip the CONTENTS, not the folder** — `manifest.json` must sit at the archive root.

⚠ **`vendor/` carries two minified libraries** — `html2canvas.min.js` (194 KB) and
`supabase.min.js` (203 KB). Review may ask for their provenance or unminified sources; have the
versions and origins ready.

### Listing requirements — none of these exist yet

- 🔴 **A privacy policy URL.** Required, and required *because* the extension authenticates users
  and talks to Supabase. **No privacy policy page exists in this repository** — only passing
  mentions in `HANDOFF.md` and `PLAN.md`.
- 🔴 **A data-use disclosure**, consistent with what the code does: it reads load-board responses
  and sends an account identity to Supabase.
- 🔴 **A single-purpose statement.** ⚠ This one needs thought: monitoring, filtering, posting a
  truck, and booking is a broad surface, and a weak single-purpose answer draws rejections.
- 🔴 **Screenshots** (1280×800 or 640×400) and a store icon.
- 🔴 **Reviewer test credentials.** 🔑 **This is the one most likely to sink a first submission.**
  The extension only activates behind a login (`isAuthGateActiveSync`, `utils/authGate.js:107`)
  **and** only on `relay.amazon.*` — a reviewer has neither an Amazon Relay carrier account nor a
  Torren login. **Without a working test account and step-by-step instructions in the reviewer
  notes, they will see a page that does nothing and reject it.** Plan for a demo account, and
  expect to explain the Amazon dependency explicitly.

---

*Audit only. Nothing here was fixed, and no other document was edited. What gets done, and in
what order, is Ihor's decision.*
