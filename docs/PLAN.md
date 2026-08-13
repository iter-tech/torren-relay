# PLAN.md — ordered source of truth

Status key: **next** = ready to start | **in progress** = started, unfinished | **blocked** = waiting on a named thing | **done**
One task at a time, in this order. Detail lives in STATE.md / BACKLOG.md; sequence lives here.

---

## Before launch

1. **Live DOM capture — main vs similar list.** **done** (2026-08-13). Structure recorded in `AMAZON_SELECTORS.md`: the summary panel is a **sibling** of the results, not a container.
2. **Fix `findMainResultsList` to the captured selector.** **done** (2026-08-13), live-verified under task 3. Anchors on `#search-results-summary-panel` and walks following siblings; card ids collected by UUID shape rather than card class.
3. **Live verify per-cycle cityAssign.** **done** (2026-08-13). Across several auto-refresh cycles: `CITY DIAG 0/5` MATCH: YES every cycle, `CITY DIAG 3/4` intersection **full (30/30, 28/28)**, zero unmatched, zero RESET lines, and the board rendered normally with the `Response.prototype` wrapper in place. Required capturing via Amazon's own `Response.json()` read — the SPA's abort kills any cloned read (api-samples.md §6.8). All five debug flags returned to shipped state afterwards.
4. **Rebuild the harness suites on the real DOM structure.** **done** (2026-08-13). Seven suites retired (six obsolete or fixture-broken — including `cityraw-harness`, a sixth not in the original scope — plus two green ones now subsumed); replaced by a shared `fixtures.mjs` modelling the live-captured board and two suites: `cityassign-suite` (91) and `capture-suite` (64). **155 green, 0 red.** Zero production changes. One cosmetic diagnostic defect found and deliberately left unfixed, recorded as a passing assertion — see CHANGELOG.
5. **Audit `loadParser.js:124`** — same "first `div.load-list`" assumption, feeds highlight and sound. **done** (2026-08-13). Audit found it was **not** reading Similar-matches cards (document order put main first and collection was already scoped), so this was hardening rather than a bug fix — the lookup now anchors on the summary panel and walks following siblings, with a fallback to the old behaviour on panel-missing so the alert can never go silent. The suspected silent alert-miss was also **disproved**: a live 10-of-10 capture showed the recently-added card carries `div.wo-card-header--highlighted`, which the existing selector list already matches. 49 new checks; 204 green overall.
6. **cityAssign: log-only → actually filtering cards.** blocked (on 3). *Verify: card count per city matches what I count on the board by eye; nothing else on the board moves.*
7. **Wire the city-button click to per-city filtering.** blocked (on 6). *Verify: one click on a city shows only that city's loads; click again returns all.*
8. **Post-a-Truck: R-type (own-trailer) support.** blocked (needs a captured manual R upsert payload). *Verify: PAT footer on an R load no longer says "(Provided)", and a real R post goes through.*
9. **Correct stale claims in `api-samples.md` §6.5 / §6.7.** next. *Verify: nothing on screen — docs only.*
10. **Cross-tab rate limiting — live multi-tab test (🚫 pre-launch blocker).** next. *Verify: 4 tabs open, aggregate request rate equals the global interval, not 4×; a forced 503 pauses and resumes all tabs together.*
11. **Full manual smoke pass + outstanding TEST_CASES.** blocked (on 6–8). *Verify: all six smoke items pass — popup opens clean, logged-out popup shows only login, full login flow, sidebar activates, PAT modal Confirm enables, no page-console errors.*
12. **All five debug flags back OFF, final build check.** blocked (on 11). *Verify: at stock level the console shows no CITY / capture lines at all.*
13. **Store submission package** — manifest description copy, icons 16/32/48/128, privacy policy page, listing materials, data disclosure, version bump, zip. next (non-code). *Verify: I load the zipped build unpacked and it behaves exactly like the working tree.*

---

## Post-launch / unscheduled

14. **Multi-Driver Monitor UI** — driver sub-tabs, per-driver new-load counter, colour stripe on the "All" view. *Verify: a new load for one driver highlights that driver's tab and flashes the card.*
15. **Re-capture the five-city response into `samples/`, re-confirm findings 1, 3, 4.** *Verify: nothing on screen — a file exists and matches.*
16. **Tune `CITY_ASSIGN_MAX_MILES` (150) and `CITY_ASSIGN_SETTLE_MS` (700) against real logs.** *Verify: no load lands in the wrong city and none goes unmatched on a normal board.*
17. **Persist the city-coordinate cache across page reloads.** *Verify: after a reload the city panel fills without a visible delay.*
18. **Split the ~400 flag-gated diagnostic lines out of `cityAssign.js`.** *Verify: nothing on screen — ergonomics only.*
19. **Collapse Amazon's left filters panel on START.** blocked (no reliable read of open vs collapsed). *Verify: pressing START collapses the panel and never re-opens it.*
20. **Price-increase payout selector** (`__modified-load-increase-attr`). blocked (needs one capture of a price-increased card). *Verify: payout shows on a price-increased card instead of the "could not be read" warning.*
21. **Non-US locale handling.** blocked (needs a capture from a non-`.com` domain). *Verify: board on a non-US domain parses cities and addresses correctly.*
22. **Auto-restore Amazon filters after reload.** *Verify: my filters come back after a page reload.*
23. **Memory-leak / caching audit items 3 and 5.** *Verify: memory indicator stays flat over a long session.*
24. **Missing PAT / inline-panel fields** — per-segment payout, segment ID label, stop-level warnings. *Verify: those fields appear in the panel where the board shows them.*
25. **B1 follow-ups** — logout arriving mid-activation; `ext-sidebar-styles` never removed on teardown. *Verify: repeated login→logout cycles leave no duplicate styles and no sidebar for a logged-out session.*
26. **Status-handling decisions** — sustained 404 loud log, 401/403 auth re-check instead of backoff. *Verify: nothing on screen normally; a stale watch path becomes visible in the console.*
27. **`supabase.min.js` deferral + `authGate.js` local-first.** measure before deciding. *Verify: popup and page activation feel no slower and nobody gets logged out.*
28. **`SAFETY.md` pass for the two new surfaces** — background service worker, MAIN-world fetch/XHR observer. *Verify: nothing on screen — docs only.*
