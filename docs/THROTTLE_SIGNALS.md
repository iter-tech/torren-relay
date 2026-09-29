# Silent throttling of the load board — what the saved data can and cannot show

**2026-09-28.** Read-only analysis of `samples/` (every HAR and JSON capture), this repository's code
and `tenlane-network` (read only). No request was sent and Relay was not opened. Ids and tokens
appear as `first-4***`; no secret header value is printed.

**The problem (Ihor, years of observation):** after very frequent refreshing from one IP, Amazon keeps
answering, and the board looks alive, but the newest loads are missing. A dispatcher on the same
Amazon account from another IP sees them.

**Bottom line:** none of the 40 saved responses carries a throttle signal. That is expected, because
none of them was taken while throttling was suspected: **we have zero positive samples.** The one
throttle this project has proven is the loud one (HTTP 503). For the silent one, the strongest
detector available today does not need Amazon's cooperation: compare our board against the loads
the Tenlane Network ingested from other dispatchers.

---

## 1. Response-body fields that could signal throttling

Scope: 40 responses of `/api/loadboard/search`, `/recommendations/get` and `/similar`. That is 28 in
HARs (`ai-chat.har` entries 17–19 and 45–47; `ai-chat-2.har` entries 3–5, 37–39, 56–58, 74–76,
78–79, 81–82 and 84–86; `competitor-ai.har` entries 6–8), plus 12 JSON captures (`capture-P*.json`,
`capture-R*.json`, `paired-search.json`, `search-*.json`, `similar-*.json`). Every response has the
same seven top-level keys: `searchAuditId, workOpportunities, carrierDetails, nextItemToken,
totalResultsSize, isBotRequest, metadata`.

| field | values seen | where | reading |
|---|---|---|---|
| **`isBotRequest`** | **`null` in 40/40** | every response above | 🔑 The only field whose name speaks to automated access. It is never `true` or `false` in any capture, so its throttled value is **unknown [?]**. It is the first thing to look at in a capture taken while throttled. |
| `metadata` (⚠ a JSON **string**, not an object — found by EXT-D11) | search: `{"reasonList":[{"code":"QUANTITY_LIMITS","clause":"CARB_INCOMPLIANCE_WARNING","contextMap":{…"action":"WARN"…,"messagingType":"DISMISSIBLE"}}]}` in every search; `null` in every recommendations response and in `similar-1.json`; `noWorkOpportunitiesClause: "CARB_INCOMPLIANCE_WARNING"` added in the 0-row `search-1.json` and `similar-empty.json` | all | ⚠ **"QUANTITY_LIMITS" is not a rate limit.** The clause is **CARB** (California emissions-compliance) coaching, a dismissible warning, and it is identical in every normal response. It would count as a signal only if a *different* code appeared. |
| `searchAuditId` | UUID, **different in every one of the 28 HAR responses** (e.g. `ai-chat.har` #18 `878e***`, #46 `2ce6***`) | all | A **repeated** id across two refreshes would mean a replayed or cached answer. Never seen; possible signal [?]. |
| `totalResultsSize` vs rows | the 50-row main list: 187 → 190 (`ai-chat.har` #18 → #46); 160 → 163 → 161 → 161 → 161 → 161 (`ai-chat-2.har` #4 → #85). The 5-row block: 116–120. recommendations: always 20/20 | all | It moves on every normal refresh. A total that **freezes** over many refreshes while the network sees new loads would be a weak signal [?]. |
| `nextItemToken` | `5` / `50` (the next page offset) when total > rows; `null` when the page holds everything | all | Paging, not throttling. Page 1 is only 50 of 161–910 (`capture-R.json`: 910), and **pages 2+ are not captured by design** (DECISIONS EXT-D3). |
| `carrierDetails.carrierEngagementScore` / `…Category` | `0` / `"UNKNOWN"` everywhere | all | Constant; no signal. |
| `workOpportunities[].searchChannelStampedDuration` | an object of 7 numbers: `workOpportunities, bidding, operator, postATruck, commercialCarrierAdhocBoard, contract, negotiation` | all | Meaning **unknown [?]**; the numbers look like per-channel durations. Not a throttle field as far as the data shows. |
| `workOpportunities[].expirationTime` | `null` everywhere | all | No signal. |
| anything named `throttle`, `rate`, `quota`, `stale`, `cache`, `degraded`, `captcha`, `block` | **none**, across all 40 bodies (key-name scan of every nested object) | — | — |

**Request side** (Amazon's own client, for comparison): `isAutoRefreshCall` is `true` on the 50-row
refresh in `ai-chat.har` #18/#46 and `ai-chat-2.har` #4/#38/#57/#75, and `false` elsewhere. Amazon
can therefore tell an auto-refresh from a user action. Whether it uses that to throttle is [?].

## 2. Response headers

Identical across all 28 captured search / recommendations responses (names and value patterns;
ids masked):

| header | value | reading |
|---|---|---|
| `x-cache` | `Miss from cloudfront` (28/28) | Every answer came from the origin, not CloudFront's cache. A **`Hit`**, or an `Age:` header, on a board response would show a cached (stale) board [?]; never seen. |
| `edge-cache-control` | `no-store,no-cache,stale-if-error=0,stale-while-revalidate=0` | Amazon tells the edge **not** to serve stale copies. That argues *against* CDN staleness as the mechanism. |
| `via` | `1.1 <hex>.cloudfront.net (CloudFront)` (4 distinct edge hosts) | — |
| `x-amz-cf-pop` | one POP code in all 28 | — |
| `x-amz-cf-id` | 56 chars, unique per response (`dmgU***`) | request id; no signal |
| `x-amz-rid` | 20 chars, unique per response (`PH3T***`) | request id; no signal |
| `server`, `vary`, `strict-transport-security`, `x-xss-protection`, `content-encoding`, `content-type` | constant | — |
| `Retry-After`, `X-RateLimit-*`, `Age`, `Cache-Status` | **absent in 28/28** | — |

Also seen: `ai-chat-2.har` **#83** (21:29:43.352) is the 50-row board search with **status 0,
`net::ERR_ABORTED`, and no body**. The page itself cancelled it and re-issued it as #85
(21:29:43.491, 200). This is not a throttle signal, but a detector must not count an aborted request
as an "empty board".

## 3. Freshness — "how new is the newest load we were shown?"

**Measurable.** Every work opportunity carries **`createdAtTime`** (ISO-8601 UTC) in all 40
captures (e.g. `ai-chat.har` #18: `2026-09-18T07:15:19Z … 2026-09-24T21:36:17Z`). It also carries
`version`, a per-load edit counter (1–383, e.g. `capture-R.json`), which says nothing about how new a
listing is.

Age of the newest `createdAtTime` at the moment of the request (request time from the HAR):

| response | endpoint · rows/total · sort | newest load was | rows < 30 min old |
|---|---|---|---|
| `ai-chat.har` #18 / #46 | search · 50/187, 50/190 · relevance | 20.5 / 21.3 min old | 2 / 1 |
| `ai-chat.har` #19 / #47 | recommendations · 20/20 | 25.6 / 26.4 min | 1 / 1 |
| `ai-chat-2.har` #4 | search · 50/160 | 29.2 min | 1 |
| `ai-chat-2.har` #38, #57, #75, #79, #85 | search · 50/161–163 | **5.6 – 6.8 min** | 2 each |
| `ai-chat-2.har` #5, #39, #58, #76, #81, #86 | recommendations · 20/20 | 5.4 – 7.5 min | 2 each |
| `competitor-ai.har` #6 | search · 40/40 · **sort `startTime`** (LoadFetcher's own query) | 7.8 min | 2 |
| `competitor-ai.har` #8 | search · 50/63 · relevance | 56.8 min | 0 |
| the 5-row block (`ai-chat.har` #17; `ai-chat-2.har` #3 …) | search · 5/116–120 | 343 – 808 min | 0 (a different, older-load section) |

⚠ **Three things limit this metric, and all three are proven from the data:**
- **The board is sorted by `relevanceForSearchTab`, not by creation.** `createdAtTime` is out of
  order in every response, so the newest load of the search may be on page 2 or later, which we do
  not see.
- **Page 1 is a fraction of the result:** 50 of 161–910.
- **The recommendations block** (the "Recently added" cards, `networkObserver.js:93-97`) is the
  closest thing to a newest-first list, but it is 20 rows, sorted by `relevance`.

[?] Whether `createdAtTime` is when the load was **posted to the board** or when Amazon created it
internally (tendered earlier) is not established.

## 4. What our extension records today

| signal | recorded? | where |
|---|---|---|
| HTTP status of `/api/loadboard/search` (503/5xx) | ✅ reported and **acted on**: a global backoff across tabs | `networkObserver.js:190-196` (`report()`), `background.js:1-6` ("3-4 tabs at 2s each caused sustained HTTP 503 … switching networks restored access immediately (IP-based throttle, not account-based)"), `background.js:97-118` |
| `totalResultsSize`, `nextItemToken`, `searchAuditId` | ✅ carried on the capture message; logged; used for pagination diagnostics | `networkObserver.js:257-258`, `:576-583`; `cityAssign.js:3680`, `:3695-3696`, `:1109-1116`; `content.js:262` |
| `isBotRequest`, `metadata` | ❌ never read | — |
| `createdAtTime` | ❌ not in the projection (`projectRecord`, `networkObserver.js:365-482`), so neither the panel nor the backend ever sees it | `loadSender.js:276-316` (`toRow` payload) |
| response headers (`x-cache`, `Age`, …) | ❌ never read | — |
| our own first sighting of a load | ✅ in memory only, per tab | `utils/loadStore.js:41` (`firstSeenAt: Date.now()`) |

## 5. Cross-check against the Tenlane Network — **feasible**, with named caveats

**What the backend already has** (`tenlane-network`, read only):
- `public.loads`: one row per Amazon load, deduplicated on the **global** `amazon_wo_id`, measured
  identical across two Amazon accounts (`0001_loads.sql:7-11`). It has **`first_seen_at`** (the
  Tenlane DB clock at first ingest by *anyone*), `last_seen_at`, `seen_count` and
  `pickup_lat/lng` (`0001_loads.sql:44-58`).
- Every signed-in user can read it (RLS `using (true)`, `0001_loads.sql:86-90`), with an index on
  `last_seen_at` (`:76`) and on pickup coordinates (`0007_deadhead_from.sql:104-106`).
- **`loads_search(p_lat, p_lng, p_dests)`** returns every load with `deadhead_mi` from a point and
  both timestamps (`0012_pickup_delivery_times.sql:121-195`). It has no time filter and no limit;
  callers filter through PostgREST, as the site does. The site already uses `first_seen_at` for "new"
  (`web/src/lib/loads.ts:501-504`).

**The check (a design, not built):** every few minutes, and **never per refresh**, the extension
asks the network for loads with
- `first_seen_at > now() − 10 min`,
- `deadhead_mi ≤` the dispatcher's origin radius around his origin city (`loads_search` with that
  city's lat/lng),
- the same load type / equipment, and `last_seen_at` recent (still live).

It then subtracts the ids **its own tab has seen**, which it knows: `loadStore`, and the ids on the
capture message. If several loads remain across two consecutive checks, while our board's own
freshest `createdAtTime` stops advancing, it shows the dispatcher "other dispatchers are seeing N
newer loads in your area that your board is not showing." The query goes to Supabase, **not to
Amazon**, so the check itself adds no Amazon traffic.

**Caveats, each from code:**
- **Per-user observation tracking was deliberately dropped** (`0001_loads.sql:16-21`). The network
  cannot say *who* saw a load. The subtraction handles that on the client, because the tab knows its
  own ids, but a load our own sender ingested and our board then lost would look "seen by the
  network".
- **`first_seen_at` is our clock, not Amazon's.** The payload does not carry `createdAtTime`
  (`loadSender.js:276-296`). Adding it (one field to `projectRecord` and `toRow`) would make "newer"
  mean Amazon-newer.
- **Other dispatchers' searches differ:** equipment, dates, destination, driver type, stops, and
  pages 2+ (EXT-D3). A load missing from our page 1 is not proof of throttling. The warning must be a
  hint with a threshold, never an alarm on one load.
- **It needs network density:** in an area where no other Tenlane dispatcher is active, the check has
  nothing to compare against.

## 6. Ranking of detection methods

| # | method | evidence |
|---|---|---|
| 1 | **HTTP 503 / 5xx on search** | ✅ **Proven live** and already handled (`background.js:4-6`). But it is the *loud* throttle, not the silent one Ihor describes. |
| 2 | **Network cross-check** (§5) | ✅ **Feasible from the code and schema**; no Amazon data needed. Strongest practical detector; false positives from differing filters, managed by thresholds. |
| 3 | **Freshness stall**: our newest `createdAtTime` stops advancing and no new ids appear over N refreshes, while `totalResultsSize` still moves | Measurable (§3), but noisy because of the relevance sort and page-1-only view [?]. Best used as a second condition on #2. |
| 4 | **Amazon-side markers**: `isBotRequest` becoming non-null, a new `metadata` code, `x-cache: Hit` / `Age`, a repeated `searchAuditId` | **[?] Never observed: zero positive samples.** Cheap to watch once a capture shows which one moves. |

**The single capture that would prove the Amazon-side signal.** It is taken **when it happens
naturally**, not provoked:
- **Two HARs of the same saved search on the same Amazon account, in the same minute.** **A** is from
  the IP that has been refreshing all day, at the moment Ihor believes it is degraded. **B** is from a
  different IP, e.g. a phone hotspot on a second browser profile.
- Both with DevTools "Preserve log" on, **no filter** (the last HAR was saved with a type filter;
  `AI_CHAT_CAPTURE.md` §9.6), and saved as "HAR with content".
- Diffing A and B on work-opportunity ids, `totalResultsSize`, `isBotRequest`, `metadata`,
  `x-cache`/`Age` and the newest `createdAtTime` would show whether Amazon *marks* the throttled
  response or silently filters it. If B has newer ids and A shows no marker, then #2 is the only
  possible detector, and that is worth knowing too.

🔴 **Reproducing throttling on purpose risks Ihor's Amazon account.** It means deliberately sending
Amazon's API far more requests than a person would, from one IP. Amazon's own response has a field
named `isBotRequest`, and a request flag for auto-refresh. How Amazon treats an account it
classifies as automated is not known from anything in this repository. A warning or suspension of a
dispatcher's Relay account would cost far more than this detector is worth. **Do not induce it.**
Capture it the next time it happens during normal work, and keep the extension's refresh rate where
it is.

---

**Method.** Node over every file in `samples/`:
- each HAR entry whose URL matches `/api/loadboard/(search|recommendations/get|similar)`, with its
  response headers (names; values only for non-secret headers, ids masked), its request body and a
  recursive key-name scan of its response;
- each JSON capture, scanned for objects holding `workOpportunities` or `isBotRequest`.

The newest-load age is `request startedDateTime − max(createdAtTime)`. Code and schema citations
were read directly. Nothing was modified except this new file.
