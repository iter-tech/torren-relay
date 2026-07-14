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
