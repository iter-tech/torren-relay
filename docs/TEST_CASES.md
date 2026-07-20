# Test Cases

## Stage 1
- [ ] Loads in chrome://extensions without errors
- [ ] Background logs on install
- [ ] Content logs on Amazon Relay

## Stage 2
- [ ] logger formats correctly
- [ ] debug hidden when DEBUG_LEVEL < 2
- [ ] FORBIDDEN_SELECTORS exported

## Stage 3
- [ ] Sidebar visible, top-center
- [ ] Amazon content not covered
- [ ] Stays fixed on scroll

(continue per stage)

---

## Per-tab state isolation (2026-06-18)

Two relay.amazon.com tabs open simultaneously. All cases verified with both tabs visible.

### TC-TAB-1 — Pause in Tab A does not stop Tab B
1. Start loop in Tab A and Tab B.
2. Click pause in Tab A.
3. **Expected:** Tab A pill shows paused, scanline stops. Tab B pill stays running, scanline continues.

### TC-TAB-2 — Auto-stop after new load in Tab A does not stop Tab B
1. Start loop in both tabs.
2. A new load appears in Tab A — loop auto-stops in Tab A.
3. **Expected:** Tab A pill pauses. Tab B continues running unaffected.

### TC-TAB-3 — Different speeds run independently
1. Set Tab A slider to 1 s, Tab B slider to 5 s.
2. Watch refresh cadence in each tab.
3. **Expected:** Tab A refreshes ~1×/s, Tab B ~1×/5 s. Changing one slider does not change the other.
4. Reload Tab A (memory-reload simulation): after resume, Tab A speed is still 1 s.

### TC-TAB-4 — Surge thresholds are independent; history is per-tab
1. Set sidebar-surge-threshold to $50 in Tab A, $100 in Tab B.
2. Run `__EXT_DEBUG.simulateSurge()` in Tab A with amount=$60.
3. Start loop in Tab A; wait one tick.
4. **Expected:** Tab A surge triggers (60 >= 50). Tab B is unaffected.
5. Run `__EXT_DEBUG.simulateSurge()` in Tab B with amount=$80.
6. Start loop in Tab B; wait one tick.
7. **Expected:** Tab B does NOT trigger (80 < 100).
8. Open chrome://extensions DevTools → `chrome.storage.local.get('priceHistory')` should return `undefined` or `{}` (price history is no longer stored there).

### TC-TAB-5 — Manual memory-indicator reload: loop starts paused, settings restored
1. Set Tab A slider to 3s and surge threshold to $75. Start the loop.
2. Click the `ext-memory-indicator` dot in the Tab A sidebar (or press Enter/Space on it).
3. **Expected after reload:**
   - Tab A loop starts **paused** (pill shows paused, scanline is still).
   - Tab A slider still shows 3s (restored from sessionStorage via `tabState.init()`).
   - Tab A surge threshold still shows $75 (same mechanism).
   - Tab A does NOT auto-resume — the dispatcher must press play manually.
   - Tab B is unchanged throughout.
4. **Confirm no `ext_resume_after_memory_reload` flag:** in Tab A console before clicking the indicator, verify `sessionStorage.getItem('ext_resume_after_memory_reload')` returns `null`. After reload, same check — still `null`.

### TC-TAB-6 — Global settings apply to both tabs
1. In popup: toggle Night Mode on.
2. **Expected:** both Tab A and Tab B switch to dark theme simultaneously.
3. Repeat for Tab Alert, sound volume, tag filters.
4. **Expected:** all global settings propagate to all tabs via chrome.storage.onChanged.

---

## Panel closer fixes (2026-06-18)

### TC-PANEL-1 — Filter panel closes on loop start (FIX 1)
1. On Amazon Relay, open the filter popover (click the Filter button — verify button has `aria-expanded="true"`).
2. Start the loop (click play in the sidebar).
3. **Expected:** filter popover closes immediately; button returns to `aria-expanded="false"`. Loop continues as normal.
4. **Regression check:** start loop when filter popover is NOT open — no error, loop starts normally.

### TC-PANEL-2 — Manual card open stops loop (FIX 2)
1. Start loop in the tab (pill shows running, scanline animates).
2. While loop is running, manually click any load card to open its detail panel.
3. **Expected:** `#selected-work-sheet` opens AND loop stops in this tab (pill shows paused, scanline stops).
4. **Regression check (extension auto-open):** let the loop find a new load and auto-open it — loop ALSO stops (via content.js existing logic), inline panel shows. No double-stop error in logs.
5. **Per-tab isolation:** open two tabs. Stop loop in Tab A via manual card click. Tab B should continue running unaffected.

### TC-PANEL-4 — Clicking card B while card A's sheet is open shows B's data, not A's
1. Click card A. Wait for the inline panel to appear under card A (showing A's route).
2. While A's sheet (`#selected-work-sheet`) is still open, click card B (a different card).
3. **Expected:** the inline panel moves under card B and displays B's route and stops — NOT A's data.
4. **Confirm in logs:** no `waitForSheet` callback fires until the fingerprint changes (payout, expander count, or first stop label changed from A to B). If the timeout fires instead (1500ms), readSheetData reads B's already-loaded sheet.
5. **Regression check:** if A and B happen to have identical payout/expander count/first stop (unlikely), the timeout path still runs and should not render A's data if B's sheet has loaded.

### TC-PANEL-5 — Auto-opened panel can be toggle-closed with one click; old card does not close new panel
1. Start loop. Let auto-open fire on card X. Confirm inline panel appears under card X.
2. **Expected:** `currentPanelCard` now points to card X (set by `showInlinePanel`).
3. Click card X once. **Expected:** panel under card X is removed. Loop stays paused (already paused by auto-stop).
4. Now start loop again. Auto-open fires on card Y (a different card). Panel appears under Y.
5. Click card X (the PREVIOUSLY opened card). **Expected:** nothing happens — card X's click falls through to the toggle-on path (waitForSheet) because `currentPanelCard === cardY ≠ cardX`. Card Y's panel is NOT removed.

### TC-PANEL-3 — Toggle-off card click does not double-stop
1. Start loop. Manually click a card (loop stops, panel appears — TC-PANEL-2 satisfied).
2. Click the same card again to close the inline panel (toggle-off path).
3. **Expected:** panel closes. Loop remains stopped (no redundant start/stop cycle).
4. No errors in console.

---

## MutationObserver instant detection (2026-06-18)

### TC-OBS-1 — Radius (or any) filter change highlights new loads instantly
1. Set timer tick to 6s. Start loop (running = true).
2. Change the radius filter (or any filter param) in the filter panel.
3. **Expected:** new loads highlighted (`.ext-new-load`) within ~200ms — WITHOUT waiting for the 6s tick. Sound alert and tab flash fire if new loads found.
4. **Console confirms (attempt 3):** `DIAG callback: fired` entries appear during filter change, then `DIAG callback: external change while running — debouncing`, then `runObserverPipeline called` within 200ms — WITHOUT waiting for the next tick.

### TC-OBS-2 — Auto-open and auto-stop fire on observer-driven pass
1. Start loop with Auto-Open enabled.
2. Change filter so a new load appears.
3. **Expected:** top new load card opens (detail sheet + inline panel) AND loop stops (pill shows paused) — same behaviour as timer tick with new loads. Loop was stopped by `tabState.set('running', false)` in `runObserverPipeline`.

### TC-OBS-3 — No infinite observer loop from ext DOM mutations
1. Start loop. Let it find a new load and render the inline panel (highlight + badge + panel insertion).
2. **Expected:** no second pipeline pass fires as a result of the inline panel insertion or highlight class addition. Console shows "ext-managed change only — ignored" for the panel insert mutation.
3. Confirm: no duplicate sound, no double auto-open, no console error loop.

### TC-OBS-4 — Observer stops on pause; restarts on resume
1. Start loop, confirm observer is active (logs "observer active on first div.load-list").
2. Pause loop (click pause pill).
3. Change a filter. **Expected:** no pipeline pass fires (observer disconnected or running-gated).
4. Resume loop. **Expected:** observer reconnects; filter change again triggers detection.

### TC-OBS-5 — Observer is clean after manual memory-indicator reload
1. Click `ext-memory-indicator` in the sidebar to trigger a reload (no sessionStorage flag is set).
2. **Expected after reload:** loop starts paused; observer is NOT connected (observer connects only when loop is running). No stale callbacks from before reload.
3. Press play. **Expected:** observer connects and begins watching for DOM changes normally.
4. Confirm no `ext_resume_after_memory_reload` key exists in sessionStorage at any point.

---

## Inline panel stop numbers (2026-06-18)

### TC-STOP-1 — Global stop numbers appear in stop-detail table
1. Start loop. Let auto-open fire on a multi-segment load (≥ 2 legs).
2. Expand one segment's stop-detail accordion.
3. **Expected:** each address row has a blue `.ext-stop-num` circle showing the global stop number.
   - Segment 0 rows: circles "1" and "2".
   - Segment 1 rows: circles "2" and "3" (2 is shared with segment 0's destination).
   - Segment 2 rows: circles "3" and "4" (3 is shared with segment 1's destination).
4. **Regression check (single-segment load):** circles "1" and "2" appear.

### TC-STOP-3 — Segment with 3 stops: continuous numbering, no duplicates in next segment
1. Find or simulate a load with a segment that has 3 stops (e.g., pickup + mid-stop + delivery).
2. Open the inline panel. Expand all segments.
3. **Expected stop numbering (example: seg0=3 stops, seg1=2 stops, seg2=2 stops):**
   - Segment 0: stop circles "1", "2", "3"
   - Segment 1: stop circles "3", "4"  ← "3" shared with seg 0's last stop
   - Segment 2: stop circles "4", "5"  ← "4" shared with seg 1's last stop
4. No duplicate number appears more than twice (boundary stops only).
5. **Regression (2-stop segments):** original documented example still produces 1,2/2,3/3,4 for three 2-stop segments.

### TC-STOP-2 — Shared stop has identical number in both segments
1. Open a 3-segment load's inline panel.
2. Expand segment 0 and note the destination stop number (e.g., "XBN6 → 2").
3. Expand segment 1 and note the origin stop number.
4. **Expected:** both show the same number ("2"). Stop numbering is continuous, not per-segment restarted.

---

### TC-OPEN-1 — Auto-open targets highest-paying new load, not DOM-first
1. Arrange the load board so card A ($250, first in DOM) and card B ($480, second in DOM) both appear as new loads in the same tick.
2. Start the loop. When the tick runs and detects both, **Expected:**
   - Both cards receive `.ext-new-load` highlight (order irrelevant).
   - The detail panel opens for card B ($480 — higher payout), not card A.
   - The inline panel renders under card B.
3. Confirm in logs: `runDetectionPipeline: inline panel shown` with `topPayout: "$480.xx"` (or the actual higher value).

### TC-OPEN-2 — Card detach during 250ms settle: no click fires, no error
1. Start loop. When auto-open fires (a new load is found), immediately change a filter in Amazon's filter panel so that Amazon React unmounts and remounts the load list within the 250ms scroll-settle window.
2. **Expected:** console shows `detailOpener: element detached during scroll settle — NOT clicking`. No `.click()` fires. No console error. Loop is already paused (auto-stopped before the click was scheduled).
3. **Regression check:** normal tick with stable DOM — card remains attached, click fires as expected.

### TC-PARSE-1 — Highlighted card produces no null-loadId duplicate
1. Open the load board and let Amazon highlight a card (`.wo-card-header--highlighted` applied to an inner header inside a `.load-card`).
2. Run `__EXT_DEBUG.getLoads()` in the console.
3. **Expected:** each load appears exactly once in the returned array. No entry with `loadId: null` is present. No `loadParser: failed to parse card` error appears in the console for the highlighted card.
4. Confirm in logs: if any nested elements were filtered, `dropped nested card matches` debug line appears with `dropped: N` (N ≥ 1).

### TC-LOOP-1 — Rapid play→pause→play does not start parallel loops
1. Start loop (play). Immediately click pause then play again, all within 1 second.
2. **Expected:** exactly one loop chain runs. Only one refresh fires per interval. Only one sound plays per new load batch. Pause fully stops the loop (no "ghost" tick continues).
3. **Confirm in logs:** `startOrchestrator: loop already active — ignoring` appears on the second play while the first tick is still in-flight. `orchLoopActive` is set before the first tick, so the second call hits the guard immediately.

### TC-STORE-1 — LoadUnit detail data survives transient empty render during filter change
1. Start loop. Let auto-open fire for a load — this triggers Phase 2 (`showInlinePanel`), which merges `detail` into the LoadUnit. Confirm via console: `__EXT_DEBUG.getLoadUnits()` shows the load with a non-null `detail` field.
2. Change an Amazon search filter (e.g., radius slider). Amazon React unmounts and remounts the load list, which may briefly show 0 cards.
3. Change the filter back to restore the same load.
4. **Expected:** `__EXT_DEBUG.getLoadUnits()` still shows the load with its `detail` field intact. The transient 0-card render did NOT trigger `pruneLoadUnits` (logs show "skipping pruneLoadUnits (transient empty render)").
5. **Regression check:** when a load genuinely disappears (filter excludes it permanently), it IS eventually pruned — confirmed after the next parse that returns ≥1 card.

### TC-OBS-6 — Back-to-back observer + timer tick: no duplicate alert
1. Start loop with timer interval = 2s.
2. At t=0, a filter change triggers the observer; observer runs at t=200ms (debounce). Finds 0 new loads.
3. At t=2000ms, timer tick runs. Also finds 0 new loads.
4. **Expected:** only ONE detection pass' worth of behaviour — no duplicate sound, no double highlight. `detectNewLoads` idempotency confirmed.

---

## Memory indicator (2026-06-30)

## Popup / sound (2026-07-03)

### TC-POPUP-1 — Auto-Open OFF: highlights and sound fire, but no card opens
1. Open popup → toggle **Auto-Open Top Load** OFF.
2. Start loop. Wait for a new load to appear.
3. **Expected:**
   - Cards with `.ext-new-load` highlight appear (highlighting always fires).
   - Sound plays (alert always fires).
   - Tab title flashes if Tab Alert is ON.
   - Loop auto-stops (tabState running → false).
   - NO detail card opens (`openTopNewLoad` is not called).
   - NO inline panel renders under any card.
4. **Reset check:** open popup, click Reset to defaults → Auto-Open toggle returns to **ON** (true-default).

---

## PAT modal (2026-07-07)

### TC-PAT-1 — Create Post on a freshly loaded page with the loop never started
1. Load `relay.amazon.com` (fresh page load or hard reload).
2. Do NOT press Play in the sidebar. The loop has never run; `parseLoads()` has never been called.
3. Click any load card that shows a "53' Trailer" to open its detail sheet.
4. Wait for the inline panel to appear below the card (manual toggle path, `waitForSheet` callback fires).
5. Click the `ext-action-post` button (document icon).
6. **Expected:**
   - In the console: `ext-action-post: Phase 1 missing — parsing card on demand` log line; also logs `usedLive: true` (live DOM node resolved via `getElementById`) and `sameNode` (`true` when the live outermost node is the same element as the captured `cardElement`; `false` when card nesting caused `initManualToggle` to capture an inner node — this is the scenario `findLiveOutermostCard` corrects).
   - The PAT modal opens immediately.
   - Origin and destination city name areas show the board stop codes (pre-parse placeholder), then switch to resolved city names as the API call completes.
   - Payout field shows `boardPayout + 5000` (a large number, not $0 or blank).
   - $/mi and min/max miles are computed from `distance`.
   - Equipment shown in the summary row matches the card's equipment text.
   - No "Could not read load data" error; no "unsupported equipment" error.
7. **Regression check (loop running):** start the loop, let a card auto-open. Click `ext-action-post`. Expected: `ext-action-post: Phase 1 missing` log does NOT appear (Phase 1 was already populated by `parseLoads()`). Form opens with the same data.
8. **Edge case — card layout unexpected:** if `parseOneCard` returns empty equipment (selector `.equipment-type-text` absent or different), expected:
   - `ext-action-post: on-demand parse yielded empty Phase 1` error log with `outerHTMLLen` and `loadId`.
   - Modal opens showing "Could not read load data from this card — start the refresh loop once, or report this card layout to the PM." (testid `pat-no-equipment`).
   - No network request is made.

### TC-PAT-2 — Distance > 1000 mi: MIN/MAX compute correctly with comma in distance string
1. Open the inline panel for a load whose board distance shows `"1,233.2 mi"` (or any value with a thousands-comma).
2. Click `ext-action-post`.
3. **Expected:**
   - MIN miles field = `Math.round(1233.2) - 25` = **1208**
   - MAX miles field = `Math.round(1233.2) + 25` = **1258**
   - $/mi = `initPayout / 1233.2` (rounded to 2 decimals)
4. **Regression check (< 1000 mi, e.g. "104.0 mi"):** MIN = 79, MAX = 129 — unchanged.
5. **Failure signature before fix:** `distMiles = 1` (parseFloat stops at comma) → MIN = 0, MAX = 26.

### TC-PAT-3 — Payout rounding: no trailing float noise anywhere
1. Open ext-action-post for any load whose `payoutNum` produces a float-arithmetic imprecision (e.g. `boardPayout = 2279.86` → `2279.86 + 5000 = 7279.860000000001` raw float).
2. **Expected in the Payout ($) field:** `"7279.86"` — exactly two decimals, no `"7279.860000000001"`.
3. **Expected in the console logger** (`modal rendered` entry): `initPayout: 7279.86` — the variable itself is rounded, not just the field.
4. Change the $/mi field and change it back. **Expected:** Payout field remains `"7279.86"` (listener also applies `.toFixed(2)`).

### TC-PAT-4 — boardStops with full state name prefixed before city
1. Simulate a boardStops entry `"ILL1 Illinois AURORA, IL 60505"` (open `ext-action-post` on a card whose origin has this entry, OR call `parseBoardStop("ILL1 Illinois AURORA, IL 60505")` directly in the console).
2. **Expected result:** `{ city: "AURORA", state: "IL" }`.
3. **Regression — normal entry:** `parseBoardStop("DNA4 MEMPHIS, TN 38128-2510")` → `{ city: "MEMPHIS", state: "TN" }` unchanged.
4. **Regression — multi-word city starting with state-ish word:** `parseBoardStop("XYZ1 NORTH LITTLE ROCK, AR 72117")` → `{ city: "NORTH LITTLE ROCK", state: "AR" }` (no stripping — "north little rock" does not start with any state name + space).

### TC-PAT-5 — Dotted abbreviation in city triggers API retry with expanded name
1. Simulate a boardStops origin entry `"TNK1 MT. JULIET, TN 37122"`.
2. **Expected flow in console:**
   - First fetch: `GET /api/loadboard/filters/cities/search/MT.%20JULIET` — attempt primary + fallback match.
   - If no match: log line `resolvePATCity: retrying with expanded abbrev { from: "MT. JULIET", to: "MOUNT JULIET" }`.
   - Second fetch: `GET /api/loadboard/filters/cities/search/MOUNT%20JULIET` — primary match on `"MOUNT JULIET, TN"`.
3. **Expected modal:** origin city resolves to `"MOUNT JULIET, TN"`.
4. **No retry when no abbreviation:** city `"MEMPHIS"` — no second fetch is issued (`expandedCity === city`, condition false).
5. **ST. / FT. variants:** `"ST. LOUIS, MO"` → retry with `"SAINT LOUIS, MO"`; `"FT. WAYNE, IN"` → retry with `"FORT WAYNE, IN"`.

### TC-PAT-6 — Abbreviated board city name resolves via prefix+subsequence fallback
1. Simulate a boardStops entry `"NJC1 BURLNGTN TWP, NJ 08016"` (or use a real card with that board text).
2. Click `ext-action-post`. Watch the console.
3. **Expected console sequence:**
   - `resolvePATCity: retrying with expanded abbrev` — NOT logged (no dotted abbreviation in "BURLNGTN TWP").
   - `resolvePATCity: trying prefix+subsequence fallback { city: "BURLNGTN TWP", prefix: "BURL", state: "NJ" }`
   - Second GET: `/api/loadboard/filters/cities/search/BURL`
   - `resolvePATCity: prefix+subsequence matched { city: "BURLNGTN TWP", matched: "BURLINGTON TWP", state: "NJ" }`
4. **Expected modal:** origin city shows `"BURLINGTON TWP, NJ"`.
5. **No-guess case (ambiguous):** if more than one NJ city starting with "BURL" passes the subsequence check, expected log: `ambiguous prefix+subsequence — not guessing { count: N, names: [...] }` and origin city shows the "Could not resolve city" error.
6. **No-guess case (zero candidates):** no NJ city starting with "BURL" passes subsequence check → same "Could not resolve" error.
7. **Regression — normal city name:** `"DNA4 MEMPHIS, TN 38128-2510"` → primary match finds "MEMPHIS, TN" directly; prefix+subsequence fallback is never reached.
8. **`isSubseq` correctness:**
   - `isSubseq("BURLNGTNTWP", "BURLINGTONTWP")` → `true` (all 11 abbrev chars found in order)
   - `isSubseq("BURLNGTNTWP", "BURLINGTON")` → `false` (10 chars in full, can't absorb TWP)
   - `isSubseq("BURLNGTNTWP", "BURLINGTONHEIGHTS")` → `false` (no T,W,P after consuming the middle chars)

### TC-SOUND-1 — Popup preview and in-page alert produce identical tones for the same soundId
1. In the popup, select a sound (e.g. "Fanfare") and click the replay button.
2. Let the extension play an in-page alert for the same soundId (manually trigger via `__EXT_DEBUG.playAlert()` in the content console, with `soundId = 'fanfare'`).
3. **Expected:** the two sounds are audibly identical — same pitch sequence, same timing, same waveform. Both use `SOUND_DEFS['fanfare']` from the shared `utils/soundDefs.js` global.
4. Repeat for two more sounds (e.g. "Alarm siren" and "Rising sweep") to confirm no divergence.

---

## Memory indicator (2026-06-30)

### TC-MEM-1 — Indicator polls while paused, click reloads, tooltip warns about filters
1. Load extension. Keep loop **paused** (do not press play).
2. Wait ~7s. **Expected:** `ext-memory-indicator` dot color updates (reflecting current heap ratio), with no ticker/sound — indicator polls independently of loop state.
3. Hover (or focus) the `ext-memory-info` "i" icon. **Expected:** `ext-memory-tooltip` appears and text includes a warning that Amazon search filters will need to be re-entered after reload (via `textContent`; no innerHTML).
4. Click the `ext-memory-indicator` dot (or press Enter/Space). **Expected:** page reloads immediately. No confirmation dialog. No sessionStorage flag set before reload.
5. After reload: loop is paused. Speed and surge threshold restored from sessionStorage. Dispatcher presses play manually to resume.
6. **Regression check (running state):** start the loop and let it run. The dot still updates every ~7s. Clicking it still reloads. The running state is NOT preserved across the reload — loop starts paused after reload regardless.

---

## Popup login — pending state + login gating (2026-07-20)

### TC-AUTH-1 — Popup reopen during pending code restores the code step
1. In the popup, enter an email and click "Send code" (`popup-auth-send-code`). **Expected:** step advances to `popup-auth-step-code`, status shows "Code sent to …".
2. Close the popup **without** entering the code (click elsewhere on the page, or press Escape).
3. Reopen the popup. **Expected:** the popup shows `popup-auth-step-code` directly (not the email step) — `popup-auth-email` is pre-filled with the same address, and `popup-auth-status` shows "Enter the code sent to …". No new code was sent.
4. Enter the correct code and click "Verify" (`popup-auth-verify`). **Expected:** logged-in state shown; reopening the popup again now shows the logged-in step (`popup-auth-step-loggedin`), not the code step — pending state was cleared on successful verify.
5. **Regression — "Use different email" clears pending state:** repeat steps 1–2, reopen the popup (confirms code step restores), then click "Use different email" (`popup-auth-change-email`). **Expected:** returns to the email step. Reopen the popup once more — **expected:** email step again, not the code step (pending state was cleared, not just hidden).
6. **Regression — normal path unaffected:** send a code and verify it in the same popup session without closing. **Expected:** works exactly as before this change.

### TC-AUTH-2 — Logged-out state disables extension features but leaves the page untouched
1. Ensure logged out (click "Log out" in the popup if currently logged in, or use a fresh profile with no session).
2. Load (or reload) `relay.amazon.com`. Open the browser console.
3. **Expected console:** `[EXT][...][content] auth gate closed — extension inactive on this page load`. No sidebar (`ext-sidebar`), no inline panel, no Night Mode, no tag-filter hiding, no "Hide Similar Matches" — none of our `data-testid` elements exist anywhere in the DOM (`document.querySelector('[data-testid^="ext-"]')` → `null`, `document.querySelector('[data-testid^="popup-"]')` is popup-only so N/A here).
4. **Expected page behavior:** the Load Board itself works completely normally — cards render, Amazon's own filters/search/refresh/booking all function exactly as they would with the extension uninstalled. No visual difference from the unmodified page (Night Mode was never applied, `html.ext-night` is absent).
5. Open the popup. **Expected:** email step shown (or code step, per TC-AUTH-1) with `popup-auth-gate-note` visible: "Free access — sign in with your email to activate Torren Relay". See TC-AUTH-4 for the full login-only-view check.
6. Complete login (send code, verify). **Expected (updated 2026-07-20 — see TC-AUTH-6 for the detailed version):** the already-loaded Relay tab activates **immediately, no reload** — sidebar appears, `[EXT][...][content] activateExtensionUI called` logged. This used to require a reload; live reactivation was added 2026-07-20 (`utils/authGate.js` `onAuthGateChange`).
7. **Regression — logout while a tab is active:** with the loop running in a Relay tab, log out via the popup. **Expected (updated 2026-07-20):** the loop stops and the sidebar/inline panel/highlights are removed immediately, no reload — see TC-AUTH-6.

### TC-AUTH-3 — Session expired but refresh token valid refreshes silently, does not log out
1. Log in normally. In the browser console (extension popup or content-script context), locate the stored session (`chrome.storage.local.get('supabaseSession', console.log)`) and note `expires_at`.
2. Simulate near-expiry by editing the stored session's `expires_at` to `Math.floor(Date.now()/1000) + 10` (10 seconds out — inside the 30s buffer) via `chrome.storage.local.set({ supabaseSession: {...} })` in the console, keeping the real `refresh_token`.
3. Reopen the popup (or reload the Relay tab). **Expected:** no login form shown — the session is silently refreshed (`auth.refreshSession()` called under the hood), a new `expires_at` further in the future is written back to `chrome.storage.local`, and the logged-in state / sidebar appears normally. Console shows a refresh log line (`restoreSession: refreshing expired session` in the popup, or `authGate: session expiring — refreshing silently` in the content script) — **not** a logout.
4. **Regression — genuinely invalid refresh token:** repeat with a deliberately corrupted `refresh_token` (e.g. append garbage characters). **Expected:** popup falls back to the email/pending-code step (`restoreSession` catch clears the session); a content-script tab in this state logs `auth gate closed` and does not activate. This is the one case where the stored session IS cleared — by the popup only, never by a content script (see utils/authGate.js header comment).

### TC-AUTH-4 — 8-digit code accepted; code field validates digits-only, not a fixed length
1. Trigger a real "Send code" in the popup. **Expected:** Supabase emails an 8-digit numeric code (current default OTP length for this project).
2. Enter the 8-digit code into `popup-auth-code`. **Expected:** the full 8 digits are accepted — the field does not truncate at 6 characters (`maxlength="10"`), and clicking "Verify" (`popup-auth-verify`) succeeds.
3. **Label check:** the code step shows a label reading "Code from email" directly above the input (`<label for="popup-auth-code">`).
4. **Regression — too short:** enter a 5-digit value and click Verify. **Expected:** rejected client-side with "Code must be 6-10 digits, numbers only." — no `verifyOtp` call made (check the console: no `[EXT][...][popup] verifyOtp` log line).
5. **Regression — too long:** attempt to enter an 11-digit value. **Expected:** the input itself stops accepting characters past 10 (`maxlength="10"`); if 10 non-matching-code digits are submitted anyway, `verifyOtp` is called and fails server-side (not a client-side validation gap — 10 is the accepted upper bound per the spec).
6. **Regression — non-digit characters:** paste a value containing letters or symbols (e.g. "12a456"). **Expected:** rejected client-side with the same "digits only" error message; no `verifyOtp` call made.
7. **Regression — 6-digit codes still work:** if a different Supabase project configuration ever sends 6-digit codes, entering exactly 6 digits and clicking Verify **Expected:** succeeds — the validation range is 6–10 inclusive, not "8 only".

### TC-AUTH-5 — Email field is unrestricted; email and code inputs are fully independent elements
1. On a fresh popup open (logged out, email step), click into `popup-auth-email` and type a full, realistic address, e.g. `dispatcher.name+test@example-carrier.com` (36 characters, includes letters, dots, `+`, `-`, `@`).
2. **Expected:** every character is accepted — no truncation, no rejection of letters/symbols. `popup-auth-email` is `type="email"` with no `maxlength` and no digit `pattern`; it is a **separate DOM element** from `popup-auth-code` (confirmed 2026-07-20: distinct `id`s, distinct `data-testid`s, distinct parent steps `popup-auth-step-email` / `popup-auth-step-code`, mutually exclusive via the `hidden` attribute with no CSS override).
3. Click "Send code". **Expected:** `signInWithOtp` is called with the exact address typed (check the console log line `[EXT][...][popup] signInWithOtp { email: "..." }`) — no digit-stripping, no truncation to 10 characters.
4. Enter the received code (per TC-AUTH-4) into `popup-auth-code` and click Verify. **Expected:** login succeeds end-to-end — this is the full round trip (realistic email in → code in → logged-in state), not just the two fields tested in isolation.
5. **Regression — standard email format validation only:** typing an invalid address (e.g. `notanemail`) and clicking "Send code" **Expected:** whatever the current empty/format check produces (as of 2026-07-20, only an empty-value check — `if (!email) { setAuthStatus('Enter your email.', true); ... }` — the browser's native `type="email"` constraint is not additionally enforced via `checkValidity()`). This case exists to catch any future regression that accidentally imports the code field's digits-only regex onto the email field, which must never happen.

### TC-POPUP-GATE-1 — Logged-out popup shows only the login block
1. Ensure logged out. Open the popup.
2. **Expected:** visible — `popup-section-title` "Account", `popup-auth-gate-note` reading "Free access — sign in with your email to activate Torren Relay" (styled as a headline, not a small note), and the email-step form (`popup-auth-step-email`: `popup-auth-email` input + `popup-auth-send-code` button).
3. **Expected hidden (`popup-features` container, `hidden` attribute set):** "Display & Alerts" section title and everything under it — `popup-night-mode`, `popup-tab-alert`, `popup-auto-open`, the entire Sound block (`popup-volume`, `popup-sound-select`, `popup-sound-replay`), `popup-surge` + `popup-surge-threshold`, "Load Board Filters" section (all four tag toggles + `popup-hide-similar`), "Booking" section (`popup-fast-book`), and the `popup-reset` footer link. None of these should be visible or reachable by scrolling.
4. Click "Send code", then reopen the popup mid-flow. **Expected:** still only the login block (now on the code step) — `popup-features` remains hidden throughout the email and code steps, not just the initial email step.
5. Complete login (verify a valid code). **Expected:** `popup-auth-gate-note` disappears, `popup-auth-step-loggedin` shows (email + Log out) at the top, and immediately below it every control listed in step 3 reappears and is fully interactive (toggle Night Mode, adjust volume, etc. — confirm at least 2–3 controls actually respond).
6. Click "Log out". **Expected:** back to step 2's exact state — login-only view, all feature controls hidden again.

### TC-PAT-MARKUP-1 — Default Payout is board payout × 1.10, not board payout + $5000
1. Open a load card with a clear, parseable payout (e.g. board shows "$2,000.00"). Click `ext-action-post`.
2. **Expected:** once the modal renders (and, if applicable, once city resolution completes), `ext-pat-payout` defaults to `2200.00` (2000 × 1.10, rounded to 2 decimals) — not `7000.00` (the old flat +$5000 behavior).
3. **Expected:** `ext-pat-permile` defaults to `2200.00 / distMiles` (board distance), consistent with the new payout, not the old one.
4. Edit `ext-pat-payout` to a different value (e.g. `3000`). **Expected:** `ext-pat-permile` updates live via the existing $/mi ↔ payout linkage — unaffected by this change, still fully editable.
5. **Regression — rounding:** use a payout that doesn't round cleanly, e.g. board payout `$1,234.56` → expected default Payout `1358.02` (`1234.56 × 1.10 = 1358.016` → rounds to `1358.02`).

### TC-PAT-MARKUP-2 — Missing/unparseable board payout blocks Confirm, no silent fallback
1. Force a load card into a state where payout can't be read — e.g. via `window.__EXT_DEBUG` or by testing a card where `.wo-total_payout` is absent (matches the existing `payoutNum === null` fallback path already logged by `openPostModal`). Click `ext-action-post`.
2. **Expected:** `ext-pat-payout` renders **empty** (not `"0.00"`, not any other default) and `ext-pat-permile` also renders empty.
3. **Expected:** `ext-pat-payout-warning` is visible, directly under the Payout field, reading exactly: "Board payout could not be read — enter payout manually".
4. **Expected:** `ext-pat-confirm` stays disabled even after city resolution completes successfully (both origin and destination resolve cleanly) — confirm this by watching the console for the city-resolution success path and checking `ext-pat-confirm.disabled === true` immediately after.
5. Type a valid positive number into `ext-pat-payout` (e.g. `1500`). **Expected:** `ext-pat-payout-warning` disappears immediately (live, on `input` event — no need to blur/tab away), and `ext-pat-confirm` becomes enabled (assuming cities already resolved and no other blocking errors like unknown loading type or bad timezone).
6. Clear the field back to empty, or enter `0` or a negative number. **Expected:** `ext-pat-payout-warning` reappears and `ext-pat-confirm` disables again — the gating is fully live/bidirectional, not just a one-time check at render.
7. **Regression — normal case unaffected:** repeat TC-PAT-MARKUP-1 with a normal parseable payout. **Expected:** `ext-pat-payout-warning` never appears, Confirm enables normally once cities resolve (unchanged from before this fix).
8. **Regression — Confirm-click safety net:** with the warning showing (Payout still empty) somehow bypass the disabled button (e.g. via `__EXT_DEBUG` or DevTools) and click Confirm anyway. **Expected:** the existing `if (isNaN(payoutVal) || payoutVal <= 0)` check in the confirm handler still fires "Payout must be a positive number." and does not submit — the disabled-button gating and the click-handler validation are independent, redundant safeguards.

### TC-AUTH-6 — Login/logout via the popup activates/deactivates an already-open Relay tab, no reload

**Not yet run — no browser available in the environment that implemented this. Run this exact sequence before considering the feature verified.**

1. Log out (via the popup, if currently logged in). Load `relay.amazon.com` in a tab and leave it open. Open that tab's DevTools console.
2. **Expected (baseline, unchanged from TC-AUTH-2):** no `ext-sidebar`, no inline panel — page is untouched. Console shows `auth gate closed — extension inactive on this page load`.
3. Without closing or reloading that tab, open the extension popup (same window or a different one) and complete login (send code, enter the code, Verify).
4. **Expected in the already-open Relay tab's console**, within roughly a second of Verify succeeding: `[EXT][...][authGate] session storage changed — rechecking gate`, then `[EXT][...][authGate] gate transition { from: false, to: true, email: "…" }`, then `[EXT][...][content] activateExtensionUI called`.
5. **Expected visually in that tab, no reload:** `ext-sidebar` appears at the top of the page (title, play/pause pill, speed slider, memory indicator). If Night Mode was toggled on in the popup before this test, `html.ext-night` and the dark styling should also apply live. If any "Hide Similar Matches" / tag-filter toggles were on, those should also take effect live.
6. Click the sidebar's play/pause to start the loop. **Expected:** works exactly as it would after a fresh logged-in page load — detection runs, cards highlight, etc.
7. Open a load card's inline panel (manual click). **Expected:** panel opens normally.
8. Without closing or reloading the tab, log out via the popup.
9. **Expected in the Relay tab's console:** `gate transition { from: true, to: false, email: null }`, then `[EXT][...][content] deactivateExtensionUI called`, then `extension UI deactivated — page reverted to untouched state`.
10. **Expected visually, no reload:** `ext-sidebar` is completely removed from the DOM (`document.querySelector('[data-testid="ext-sidebar"]')` → `null`). The inline panel from step 7 is also removed. Any highlighted new-load cards and any Night Mode / tag-filter styling revert — the page looks exactly as it did in step 2. If the loop was running (step 6), it has stopped (no further console ticks).
11. **Regression — repeat the full login→logout cycle 3 times in the same tab without reloading.** Expected: behaves identically each time — sidebar appears/disappears cleanly, no duplicate sidebars, no visually-doubled scanline/memory-indicator animation, no growing console log volume per cycle. This specifically checks the `tabState.unsubscribe()` / `clearInterval()` cleanup added alongside this feature — without it, each cycle would leak one more permanent `tabState` subscriber and one more orphaned `setInterval`, both invisible in normal use but detectable via repeated cycling.
12. **Regression — the manual card-click listener respects the live gate too:** while logged out (post step 10), click a load card directly. **Expected:** nothing happens — no panel opens. This confirms `initManualToggle()`'s one-time-registered click listener is checking `isAuthGateActiveSync()` on every click, not just relying on the sidebar's absence.

### TC-PAT-CITY-1 — Empty-city resolution failure shows the specific message, doesn't discard a resolving sibling

Regression test for the `boardStopStr`-undefined crash fixed 2026-07-20 (found via the
read-only logic audit). Logic-level fix confirmed via a Node `vm` harness (no DOM/network
needed — see CHANGELOG.md); this test case is the still-outstanding real-browser check.

1. Open a load whose origin or destination city will parse down to an empty string — e.g. a
   board stop string that is only a station code with no city text after stripping (`"DNA4"`
   with nothing following), or force it via `window.__EXT_DEBUG` / DevTools by calling
   `resolvePATCity('')` directly in the console first to sanity-check step 2 before trying
   the full modal.
2. Click `ext-action-post` to open the PAT modal.
3. **Expected — this is the regression:** `ext-pat-status` shows a **specific** message:
   `Could not resolve city: «, » — check logger output` (or similar, with whatever
   city/state text was actually parsed) — **not** the generic `City resolution error — check
   logger output`. Confirm via the console that `[EXT][...][patApi] resolvePATCity: empty
   city from parseBoardStop { input: ... }` was logged, with a real `input` value (not
   `undefined`), and that no uncaught `ReferenceError` appears in the console.
4. **Expected — sibling not discarded:** if only ONE of origin/destination has the
   empty-city problem, the OTHER one still resolves and displays its city name normally
   (`ext-pat-origin` or `ext-pat-dest`, whichever is the working one, shows "CITY, ST" with
   `.resolving` class removed) — it must not also show an error or stay stuck on "resolving…"
   just because its sibling failed.
5. **Expected:** `ext-pat-confirm` stays disabled (city resolution failure is one of the
   existing blocking conditions — unchanged behavior).
6. **Regression — normal case unaffected:** open a load where both cities resolve
   successfully. **Expected:** works exactly as before this fix — both city names display,
   Confirm enables once other conditions are met.

### TC-PAT-TIME-1 — Missing/unparseable load time blocks Confirm and shows a warning; manual entry unblocks it

Regression test for the fabricated-time silent fallback fixed 2026-07-20 (found via the
read-only logic audit). `makeTimeStepper()`'s core logic was verified via a Node `vm`
harness (no DOM/network needed — see CHANGELOG.md); this test case is the still-outstanding
real-browser check of the full modal.

1. Open a load whose first or last stop has a missing or unrecognized-format arrival time
   (`parsePatStopTime()` returns `null` — not a `tzError`, which is the separate,
   already-covered case below). If none is available live, simulate via
   `window.__EXT_DEBUG` / DevTools, or temporarily blank a stop's arrival text.
2. Click `ext-action-post` to open the PAT modal.
3. **Expected — this is the regression:** the affected stepper (`ext-pat-start` and/or
   `ext-pat-end`) shows "Not set — click to enter" instead of a plausible-looking time. It
   must **not** show a time computed from the current wall-clock (e.g. roughly "now" or "now
   + a few hours") — that was the bug.
4. **Expected:** the `±` step buttons on the affected stepper are disabled (nothing to step
   from yet). The manual-entry date/time picker is visible immediately under it (not hidden
   behind a click, since there's nothing to display).
5. **Expected:** `ext-pat-times-warning` is visible: "Load times could not be read — enter
   start/end time manually".
6. **Expected:** `ext-pat-confirm` stays disabled even once both cities resolve successfully
   and Payout holds a valid value — confirm this by checking `ext-pat-confirm.disabled ===
   true` after city resolution completes.
7. Enter a valid date/time into the affected picker. **Expected, live, no other interaction
   needed:** `ext-pat-times-warning` disappears immediately, the stepper now shows the
   entered time and its `±` buttons re-enable, and `ext-pat-confirm` becomes enabled
   (assuming cities are resolved and Payout is valid — this is the "manual entry unblocks
   it" requirement).
8. Clear the picker back to empty. **Expected:** `ext-pat-times-warning` reappears and
   `ext-pat-confirm` disables again — the gating is live/bidirectional in both directions,
   not a one-time check.
9. **Regression — Confirm-click safety net:** with the warning showing, bypass the disabled
   button (e.g. via DevTools) and click Confirm anyway. **Expected:** "Enter both start and
   end time — cannot submit." fires and nothing is submitted — same redundant-safeguard
   pattern as the other fields (Payout, Min/Max Miles, city resolution).
10. **Regression — tzError case unaffected in behavior, only in stepper display:** open a
    load with an unrecognized timezone abbreviation in the arrival text. **Expected:**
    `ext-pat-status` still shows the specific "Unrecognized timezone: «X» in start/end time"
    message (unchanged), and Confirm remains **permanently** disabled for this modal instance
    even if a time is manually entered afterward (tzError stays in the static
    `blockingErrors` list, per "leave tzError handling as-is") — only the stepper's own
    visual now shows "Not set" instead of a fabricated time, which is expected since the
    shared fallback was removed entirely.
11. **Regression — normal case unaffected:** open a load where both stop times parse
    normally. **Expected:** works exactly as before this fix — both steppers show the real
    time immediately, `±` buttons work, no warning, Confirm enables once other conditions
    are met.

### TC-AUTH-7 — Logout mid-tick leaves no extension DOM behind

Regression test for the in-flight-tick-outlives-logout bug fixed 2026-07-20 (found via the
read-only logic audit; complements TC-AUTH-6, which covers the non-racy activate/deactivate
path). `shouldContinue()`'s bail-out logic was verified via a Node `vm` harness simulating
the exact timing (see CHANGELOG.md); this test case is the still-outstanding real-browser
check, and the hardest of the auth test cases to land deliberately by hand since it depends
on timing a logout to hit one of two narrow windows in a live tab.

1. Log in. On a Relay tab with real new loads available (or loads likely to trigger Auto-Open
   Top Load / Price Surge — enable both in the popup beforehand to widen the window), start
   the loop (Play).
2. **Target window A (~1.2s):** the moment right after the sidebar's refresh countdown fires
   — this is `REFRESH_SETTLE_MS`, the gap between `refreshNow()` and the detection pass in
   `orchestratorTick`. Log out via the popup as close to that moment as you can.
3. **Target window B (~800ms, the exact scenario from the bug report):** watch the console
   for `runDetectionPipeline: inline panel shown` (or the surge variant) — if you can log out
   in the ~800ms gap between a new load being detected/highlighted and that log line
   appearing, you've hit the exact window the bug lived in. Since this is hard to time by
   hand, try it across several ticks/reloads of the page until you land in the window at
   least once — the console log lines added by this fix
   (`runDetectionPipeline: bailing — gate/running closed { checkpoint: ... }`) make it
   obvious when you have, even if the visual difference is subtle.
4. **Expected, for either window, once you land in it:** the console shows a `bailing —
   gate/running closed` log line naming the checkpoint it caught at. No inline panel
   appears. No card is left highlighted (`.ext-new-load`). No surge badge
   (`ext-surge-badge`)/highlight (`.ext-surge-price`) appears. `ext-sidebar` is fully removed
   from the DOM (same as TC-AUTH-6) — nothing whatsoever is left over from the in-flight
   tick.
5. **Expected — sound:** if the bail-out happened at or before the `after playAlert`
   checkpoint, no sound should have played; if it happened at a later checkpoint (e.g. `after
   AUTO_OPEN read` or the `800ms settle` ones), the sound may already have played before the
   bail — that's expected and out of scope for this fix (audio can't be "un-played"; the fix
   is specifically about DOM the extension creates/restores, per the instruction's scope).
6. **Regression — logout with the loop idle (not running):** log out with the loop paused.
   **Expected:** unchanged from TC-AUTH-6 — sidebar disappears immediately, nothing else to
   check since no tick was in flight.
7. **Regression — normal ticks unaffected:** with the fix in place, start the loop and let
   several ticks complete normally **without** logging out. **Expected:** identical behavior
   to before this fix — new loads highlight, sound plays, top load auto-opens, inline panel
   shows normally, no spurious "bailing" log lines appear.
