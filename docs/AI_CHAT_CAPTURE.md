# Amazon's "Relay Assistant" chat — what the capture proves

**Source: `samples/ai-chat.har`**, 52 entries, `2026-09-24T21:56:06.748Z` → `21:57:43.499Z` (UTC in
the HAR; 14:56–14:57 local), DevTools/WebInspector. **Analysis of the saved file only — no request
was sent to Amazon and Relay was not opened.**

> ⚠ **PRIVACY.** Nothing secret is reproduced here. Session ids, load ids and the CSRF token appear
> only as `first-4***#fingerprint`, or as a described shape. Cookie and authorization values were
> never read — the HAR carries no `cookie` header on any entry. The HAR itself was not copied
> anywhere and is not committed.

---

## 1. Every chat request, in time order

The chat is **plain REST over HTTPS — two endpoints, request/response, no WebSocket, no SSE, no
polling.** No entry in the capture has `_webSocketMessages`, every response is
`application/json`, and nothing repeats on a timer.

| # | HAR clock | took | method + path | status | resp. bytes |
|---|---|---|---|---|---|
| 4 | 21:56:07.505 | 198 ms | POST `/api/loadboard/demand-support/chat-history` | 200 | 163 |
| 5 | 21:56:07.776 | 237 ms | POST `/api/loadboard/demand-support/query` — `action: start_new_conversation` | 200 | 13 114 |
| 10 | 21:56:22.120 | **4 394 ms** | POST `…/query` — `action: query`, `query: "hi chat 1"` | 200 | 12 949 |
| 17–19 | 21:56:48.2 | — | `/api/loadboard/search` ×2, `/api/loadboard/recommendations/get` — the board refreshing, not the chat | 200 | — |
| 20 | 21:56:49.507 | 197 ms | POST `…/chat-history` | 200 | 163 |
| 21 | 21:56:50.106 | 251 ms | POST `…/query` — `start_new_conversation` | 200 | 9 687 |
| 28 | 21:56:58.695 | **2 722 ms** | POST `…/query` — `query: "hi chat 2"` | 200 | 9 345 |
| 35 | 21:57:14.498 | 172 ms | POST `…/chat-history` | 200 | 163 |
| 36 | 21:57:15.154 | 259 ms | POST `…/query` — `start_new_conversation` | 200 | 6 360 |
| 41 | 21:57:23.843 | **6 229 ms** | POST `…/query` — `query: "hi chat 3"` | 200 | 6 052 |
| 45–47 | 21:57:38.2 | — | board refresh again | 200 | — |

Also in the capture and **not** part of the chat: 22 `unagi.amazon.com` telemetry beacons, 4
`relay.amazon.com/api/ons/v1/notifications` polls (2-byte bodies, every ~30 s), 3 CloudFront JS
chunks, and 8 `beoiwdadatcnobowfsvv.supabase.co` calls that are **our own extension's load sender**
(`auth/v1/user`, `rest/v1/rpc/ingest_loads`).

**Every chat request is `POST`, same-origin, with one header of interest:**
`x-csrf-token` (92 chars, fingerprint `#7bd7ac`) — **the same token value on all of them, and on
`/api/loadboard/search` and `/recommendations/get` too**. Full header name list, values never read:
`accept, accept-encoding, accept-language, content-length, content-type, origin, priority, referer,
sec-ch-ua*, sec-fetch-*, user-agent, x-csrf-token`.

---

## 2. How the load is bound to the chat

**One field, on every single request: `workOpportunityId`** — with three companions that travel with
it everywhere.

```
{ "action": "query",
  "query": "hi chat 2",
  "workOpportunityId": "e0fe***#38af15",   // 36 chars, the load (work opportunity)
  "workOpportunityOptionId": "1",
  "workOpportunityVersion": 35,
  "woMajorVersion": 2 }
```

- `chat-history` (entries 4, 20, 35) carries exactly the four fields — no `action`, no `query`.
- `start_new_conversation` (5, 21, 36) carries `action`, an **empty** `query`, and the same four.
- A typed message (10, 28, 41) carries `action: "query"`, the text, and the same four.

🔑 **IT IS PER MESSAGE, NOT PER CONVERSATION.** Every one of the nine chat requests repeats the load
id. There is no "open a session then talk" split: each message states its own load.

Proof that the binding is *honoured* server-side: each response echoes a `workOpportunity` object
whose `id` equals the id sent, with that load's own payout — `624.1434…` (entries 5, 10),
`1840.7455…` (21, 28), `588.6224…` (36, 41).

✅ **The one figure that did not match the brief is now explained — see §8.** Load 3 is described as
`$583.90` while the capture's `workOpportunity.payout` for it is **588.62** (entries 36, 41), with the
assistant saying "$589". Loads 1 and 2 match exactly (624.14, 1840.75). **Amazon raised that load's
`Base Rate` by $4.7190369583 and incremented its `version` 35 → 36 between 21:56:48 and 21:57:15**;
the next ordinary board refresh (entry 46, 21:57:38) returns 588.62 too. The screenshot is version 35
and the chat is version 36 — 27 seconds apart, both correct. No markup is involved.

---

## 3. Conversation identity

- The server returns a **`sessionId` inside the `response` field** (which is itself a JSON *string*
  for `chat-history` and `start_new_conversation`). Shape: **4 colon-separated segments, lengths
  `[3, 14, 36, 36]`, prefix `"neg"`**, total 92 chars — e.g. `neg:<account>:<uuid>:<uuid>`.
- 🔑 **THE SESSION ID CONTAINS THE LOAD ID.** Tested for all six occurrences: the sent
  `workOpportunityId` is a substring of the returned `sessionId`, every time. The session is derived
  per load, not allocated blindly.
- **A new session per load**: chat 1 `#9aa90c`, chat 2 `#26906f`, chat 3 `#897ed1` — all three
  distinct (compared as strings; never printed).
- 🔑 **THE CLIENT NEVER SENDS A SESSION ID BACK.** Searched every request body in the capture for
  each of the three session ids: **no request carries one**. The server re-derives the conversation
  from `workOpportunityId` + the account behind the cookie. There is nothing for a caller to keep.
- `chat-history` returned `messages: []` — an empty history — for **all three** loads, including the
  first, and the `sessionId` it returned matched the one the following `start_new_conversation`
  returned.

---

## 4. What happened to "hi chat 2" and "hi chat 3"

**Both were sent, and both were answered — correctly, for their own load.** This is the finding that
contradicts the symptom.

| entry | sent | server | reply (verbatim, Amazon's assistant text) |
|---|---|---|---|
| 10 | `"hi chat 1"` | 200 after 4 394 ms, `status: "IN_PROGRESS"`, `workOpportunityStatus: "CURRENT"`, 356-char string | "…**Pickup:** LUK2 (VANDALIA, OH) … **Drop-off:** FWA6 (FORT WAYNE, IN) … **Total Payout:** $624 USD. Are you interested in booking this shipment?" |
| 28 | `"hi chat 2"` | 200 after 2 722 ms, `status: "IN_PROGRESS"`, `"CURRENT"`, 197-char string | "…a load available from IND9 (GREENWOOD, IN) to HAGERSTOWN, MD with a payout of $1,841 USD. Are you interested in booking this shipment?" |
| 41 | `"hi chat 3"` | 200 after 6 229 ms, `status: "IN_PROGRESS"`, `"CURRENT"`, 216-char string | "…It picks up tomorrow at midnight from KILN in Wilmington, OH and delivers to DCL5 in Toledo, OH for $589…" |

⚠ **A SHAPE DIFFERENCE WORTH KNOWING.** For `action: "query"` the `response` field is a **plain
string** (the reply text). For `chat-history` and `start_new_conversation` it is a **JSON string**
containing `{sessionId, messages[]}`, where each message is `{messageType, content, timestamp}` and
`messageType` was `"system"` for the opening greeting. So a caller must handle two different bodies
under one field name.

There is **no error anywhere**: no 4xx, no 5xx, no error field, no empty body, and
`updatedPrice: null` on every entry.

---

## 5. Why only the first load works

**PROVEN, from the capture:** it is **not** the network and **not** the load binding. All three
conversations were opened correctly, all three messages were delivered, and all three replies came
back 200 with the right load's details. The typing indicator Ihor saw was still on screen while a
correct answer for that load was already in the browser.

**So the failure is entirely client-side: Amazon's chat panel did not render a reply it had.**

⚠ **[?] THE EXACT CLIENT MECHANISM IS NOT PROVABLE FROM A HAR** — a HAR records traffic, not
JavaScript state. Consistent with the evidence, and each unverified: one chat component instance
that stays bound to the first conversation it opened; a reply handler keyed on the first
`sessionId`/`workOpportunityId`; or a panel that is unmounted on close and never re-subscribed.
Closing and reopening "things" clears it, which is what a stale client-side binding looks like.

---

## 6. Ending or resetting a conversation

**No such request exists in this capture.** The only `action` values present are
`start_new_conversation` (×3) and `query` (×3), plus `chat-history` which sends no action at all.
Closing the panel produced **no request whatsoever** — between entry 10 (21:56:22) and entry 20
(21:56:49) the only traffic is telemetry, a notifications poll and the board refresh.

🔑 **`start_new_conversation` IS THE RESET**, and it is what the client sends every time the panel
opens — including on a load whose history is empty. ⚠ **[?]** Whether an explicit end/close endpoint
exists elsewhere in the API is unknown; nothing in this capture points at one.

---

## 7. Can the extension open the chat for a chosen load?

### Route A — replay the two endpoints ourselves

**Everything the requests need is in the capture**, and the extension already does this exact kind of
call for Post-a-Truck: a same-origin `fetch` with `credentials: 'include'` and a CSRF header
(`content/patApi.js:241-244`, `:502`).

```
POST https://relay.amazon.com/api/loadboard/demand-support/query
  headers: content-type: application/json, x-csrf-token: <live token>
  credentials: include (the session cookie the page already has)
  body: { action: "start_new_conversation" | "query",
          query: "" | "<text>",
          workOpportunityId, workOpportunityOptionId, workOpportunityVersion, woMajorVersion }
```

All four load fields are already in the extension's own captured records — `networkObserver.js`
projects the board's search response, which is where `workOpportunityId`, its `version` and
`majorVersion` come from.

⚠ **[?] THE HEADER NAME IS THE ONE OPEN QUESTION.** The chat uses **`x-csrf-token`**; the
extension's PAT code sends **`x-owp-csrf-token`**, read live from `<meta name="x-owp-csrf-token">`
(`content/patApi.js:194`). In this capture Amazon's own page sent `x-csrf-token` (92 chars) on the
chat *and* on `/api/loadboard/search`; in `samples/pat-copy-prefill.trimmed.har` its own page also
used `x-csrf-token` on `/api/loadboard/orders/*`, while our `x-owp-csrf-token` demonstrably works
there. **Whether the chat endpoints accept `x-owp-csrf-token`, and whether the meta tag's value is
the same token, is unproven.**

⚠ **[?]** Also unproven: whether a reply can be *read* this way without the panel (nothing suggests
otherwise — the reply is in the response body), and whether Amazon treats a non-UI caller
differently (rate limits, bot checks). None of it can be settled without sending a request, which
this task did not do.

### Route B — click Amazon's own chat control

**Nothing in a HAR proves a selector.** The capture contains no DOM, so the control that opens the
assistant on a card, its id/class, and whether one exists per card rather than one per board, are
**all [?]**. `docs/AMAZON_SELECTORS.md` and `AMAZON_DOM_REFERENCE.md` contain no entry for the
assistant, the chat panel or `demand-support` — searched.

### The single capture that would close it

**Reload the board, open the assistant on the SECOND load (not the first), send one message, and save
both:**

1. the **HAR** of that open — if the reply arrives 200 and renders, the first-load-only symptom is
   confirmed as client state that a reload clears, and Route A's "one reset per panel open" is enough;
2. the **outerHTML of the load card and of the open chat panel** (DevTools → right-click the card →
   Copy → Copy outerHTML), which gives the selector for Route B and the id/class of the control.

That one session answers both the "why" and the "how to trigger it" — and it needs no booking, no
`Book` button and no clicking of anything on our side.

---

## 8. The $583.90 / 588.62 question on load 3 — ✅ ANSWERED FROM THE CAPTURE ALONE

**The load:** `KILN` in Wilmington, OH → `DCL5` in Toledo, OH, `9a92***` (36 chars),
`majorVersion: 2`, `workOpportunityOptionId: "1"`, 2 stops, 186.52 mi, 20 040 000 ms,
`FIFTY_THREE_FOOT_TRUCK`, `LOADED`. Identified by its own id, not by its route, and the route is then
confirmed by the assistant's own sentence (entry 41, quoted below).

> ⚠ **PRIVACY.** The load id appears only as `9a92***`. The `x-csrf-token` was not read for this
> analysis; no cookie or authorization value exists in the HAR to read. The HAR is not committed
> (`.gitignore:8` covers `samples/`).

### Every payout value for that load in the capture, in time order

| # | HAR clock (UTC) | where | field | value | `version` |
|---|---|---|---|---|---|
| **18** | 21:56:48.215 | `POST /api/loadboard/search` (50 rows, row **[9]**) | `workOpportunities[9].payout.value` | **583.9034164677198** | **35** |
| 18 | 21:56:48.215 | ″ | `loads[0].payout.value` | 583.9034164677198 | 35 |
| 18 | 21:56:48.215 | ″ | `loads[0].costItems[0]` *Fuel Surcharge* | 162.2751839432276 | 35 |
| 18 | 21:56:48.215 | ″ | `loads[0].costItems[1]` *Base Rate* | **421.6282325244922** | 35 |
| **27** | 21:56:55.986 | `POST …supabase.co/rest/v1/rpc/ingest_loads` — **our own sender** | request body | contains **583.9034** | — |
| **36** | 21:57:15.154 | `POST …/demand-support/query` (`start_new_conversation`) | `workOpportunity.payout.value` | **588.6224534260689** | **36** |
| 36 | 21:57:15.154 | ″ | `loads[0].costItems[0]` *Fuel Surcharge* | 162.2751839432276 | 36 |
| 36 | 21:57:15.154 | ″ | `loads[0].costItems[1]` *Base Rate* | **426.3472694828412** | 36 |
| **41** | 21:57:23.843 | `POST …/demand-support/query` (`query: "hi chat 3"`) | `workOpportunity.payout.value` | **588.6224534260689** | **36** |
| 41 | 21:57:23.843 | ″ | the assistant's **prose** | **"$589"** | 36 |
| **46** | 21:57:38.180 | `POST /api/loadboard/search` (50 rows, row **[9]**) | `workOpportunities[9].payout.value` | **588.6224534260689** | **36** |
| **49** | 21:57:41.023 | `POST …/rpc/ingest_loads` — **our own sender** | request body | contains **588.6224** | — |

Entries **35** (`chat-history`) and **17 / 19 / 45 / 47** also concern this minute but carry no payout
for this load: `chat-history` responses are 163 bytes and contain no `workOpportunity`, the 5-row
`search` calls and both `recommendations/get` calls (20 rows) do not include this id at all.

### The difference is a real price change, not a chat artefact

```
              version 35 (21:56:48)      version 36 (21:57:15)        diff
payout          583.9034164677198          588.6224534260689       +4.7190369583
Fuel Surcharge  162.2751839432276          162.2751839432276        0.0000000000
Base Rate       421.6282325244922          426.3472694828412       +4.7190369583
distance        186.52319993474435         186.52319993474435       unchanged
duration        20040000                   20040000                 unchanged
rounded         $583.90                    $588.62
```

🔑 **THE WHOLE DIFFERENCE IS ONE COST ITEM.** `Base Rate` rose by **$4.7190369583**, to the tenth
decimal the same as the payout's rise; `Fuel Surcharge`, distance, duration, stop count, equipment and
load type are **byte-identical** across all four entries. Amazon also **incremented `version` 35 → 36**
across the same boundary — the field exists precisely to say "this offer is not the one you were
looking at".

🔑 **THE BOARD ITSELF AGREES 23 SECONDS LATER.** Entry 46, an ordinary board refresh at 21:57:38,
returns **588.6224534260689 at version 36** for the same row `[9]`. So the chat was not showing a
different number from the board; it was showing the board's **next** number first, because it was
called 27 s later than the search Ihor's screenshot came from.

**Therefore: Ihor's screenshot ($583.90) is version 35, and the chat (588.62, spoken as "$589") is
version 36.** Both are correct, 27 seconds apart. Nothing in the capture supports a chat-side markup:
the two versions differ by a single named cost component, and `583.9034` appears **nowhere** after
21:56:55 while `588.6224` appears **nowhere** before 21:57:15.

### Three things this settles for our own code

- ⚠ **OUR CAPTURE TRACKED IT, WHICH IS WHY IT MATTERS.** Our sender shipped `583.9034` at 21:56:55
  (entry 27) and `588.6224` at 21:57:41 (entry 49) — the same change, 45 s apart. Between those two
  moments, a stored record and Amazon's open sheet legitimately disagree by **$4.72**, which lands in
  the payout probe's own **"up to $5"** bucket (`utils/priceProbe.js`, EXT-D6). **A `differ` verdict is
  therefore not necessarily a bug in the read** — Amazon's price does move, by single-digit dollars,
  inside a minute. Ihor's live run recorded exactly **one** `differ`; this is what one can look like.
- ⚠ **`workOpportunityVersion` IN THE REQUEST DID NOT PIN THE ANSWER.** Entries 36 and 41 both **sent**
  `workOpportunityVersion: 35` (the page's stale value) and both got **version 36** back. So the field
  is not a "give me this version" parameter; the server answers with whatever is current. `[?]` Whether
  it is validated at all — e.g. whether a *booking* would refuse a stale version — is not in this
  capture and must not be assumed from it.
- ⚠ **"$589" IS THE ASSISTANT ROUNDING, NOT A THIRD NUMBER.** Entry 41's text reads:
  *"It picks up tomorrow at midnight from KILN in Wilmington, OH and delivers to DCL5 in Toledo, OH for
  $589."* `588.6224…` to the nearest dollar. No other money figure appears in that response's prose.

**Method (read-only).** `samples/ai-chat.har` parsed in node; for every entry whose request **or**
response body contains the load id, every key matching `payout|rate|monetaryAmount|price` inside
**that load's own subtree** was printed with its JSON path, plus a whole-capture scan for
`583[.,]?9`. No request was sent to Amazon, Relay was not opened, and nothing in the extension was
changed by this analysis.

---

## Appendix — what is deliberately absent from this document

- No session id, load id or token value: `first-4***#fingerprint` only, with lengths and segment
  shapes where the structure mattered.
- No cookie or authorization data: the HAR carries **no `cookie` header** on any entry (checked on
  all 19 `relay.amazon.com` entries); nothing was read from any header value.
- Ihor's own typed text was three words per message (`hi chat 1/2/3`) and is quoted as such; the
  assistant's replies are quoted because they are the evidence that the right load was answered.

---

## 9. How the competitor (LoadFetcher) opens the chat on a chosen load — `samples/competitor-ai.har`

**Source:** 19 entries, `2026-09-29T02:27:52.292Z` → `02:28:43.723Z` (UTC), WebInspector, no `pages`.
Read-only analysis in node; nothing was sent and Relay was not opened. Masking: account `A105***`,
carrier `03e2***`, loads `7443***` / `e3f0***` / `a5d1***`. The `/api/token` access tokens (entries
2, 11, 16) are **not** reproduced. Extension id `ihcg***` (LoadFetcher, per Ihor).

### 9.1 ⚠ The chat in this capture is a DIFFERENT backend from §1–§8

| | `ai-chat.har` / `ai-chat-2.har` (Amazon's icon, 09-24/25) | `competitor-ai.har` (09-29) |
|---|---|---|
| endpoints | `POST relay.amazon.com/api/loadboard/demand-support/{chat-history,query}` | `GET cloudfront.na.api.relay.amazon.dev/compass/v1/sessions/<sessionId>/events`, `POST …/compass/v1/chat/stream` (SSE, `text/event-stream`) |
| auth | cookie + `x-csrf-token` | `x-relay-access-token` from `GET relay.amazon.com/api/token` (900 s, returns `api_url`) |
| session id | returned by server (`neg:…`, colons) | **sent by the client** in the URL and body: `neg-<account>-<carrierId>-<workOpportunityId>` |
| client code | chunk `218-8c0a4f452545d178a739.js` (`getMessages`, `startSession`, `sendMessage`) | chunk `446-c977afe39d33f312a109.js` (`getSessionHistory`, `sendMessage`), same CDN `d2rgidlsfg8vnm.cloudfront.net` |

`chat/stream` body (entry 4, masked): `{"message":"Hello","sessionId":"neg-A105***-03e2***-7443***",
"clientId":"RLB-RA-SpotDemandNego","messageType":"HIDDEN:auto_start","context":{"entityIdentifiers":
{"workOpportunityId":"7443***","workOpportunityVersion":182,"woMajorVersion":2,
"workOpportunityOptionId":"1","carrierId":"03e2***"}, …}, "timeZone":…}`. The response is an SSE
stream with tool calls `get_work_opportunity`, `check_market_metrics`, ending `end_turn`.

⚠ **[?]** Whether Amazon rolled out `compass` between 09-25 and 09-29, or it is served only with
LoadFetcher present, is not decidable from these files. Both chunks come from Amazon's CDN, and no
chrome-extension frame sits *below* chunk 446 on any stack (see 9.3).

### 9.2 Chat requests in time order (Q1)

| # | UTC | request | load | `workOpportunityVersion` sent |
|---|---|---|---|---|
| 0–2 | 02:27:52.292 | translations ×2, `GET /api/token` | — | — |
| 3 | 02:27:52.844 | `GET …/sessions/neg-…-7443***/events` → `{"events":[]}` | `7443***` | — |
| 4 | 02:27:53.197 | `POST …/chat/stream` `HIDDEN:auto_start` (15.7 s stream) | `7443***` | 182 |
| 9–11 | 02:28:15.059 | translations ×2, `GET /api/token` | — | — |
| 12 | 02:28:15.348 | `GET …/sessions/neg-…-e3f0***/events` → `{"events":[]}` | `e3f0***` | — |
| 13 | 02:28:15.797 | `POST …/chat/stream` `HIDDEN:auto_start` (13.0 s) | `e3f0***` | 127 |
| 14–16 | 02:28:21.459 | translations ×2, `GET /api/token` | — | — |
| 17 | 02:28:21.740 | `GET …/sessions/neg-…-a5d1***/events` → `{"events":[]}` (4.5 s wait) | `a5d1***` | — |

There is no `action` field in this API. The equivalent of `start_new_conversation` is the
`chat/stream` with `messageType:"HIDDEN:auto_start"`.

⚠ **THREE chat opens, not two.** Entry 17 opens a third load 6 s after the second, while entry 13's
stream was still running. It has no `chat/stream` after it. [?] It could be an extra click, or a
stream that was still pending at export and therefore missing.

**Do the ids match the 3rd and 5th negotiable loads? NO, and it cannot be checked for the first
click.**
- The first open (entry 3, 02:27:52) comes **before** every `/loadboard/search` in the file. The list
  that click was made on is not in the capture. The version it sent (182) equals the one entry 8
  later returns, so the page already held that row.
- The only board state in the file is entries 7 and 8 (02:28:10, `relevanceForSearchTab`). Entry 7
  is 5 rows filtered to `eligibleFeatures: UNANCHORED_NEGO`, all `demandSupportEnabled:true`, and
  **none of them is a chat load**. Entry 8 is 50 rows, of which 8 are `demandSupportEnabled:true`, in
  order: `1311, b8ef, eeee, 2977, 62c7, e3f0, 7443, a5d1`. So the chat loads are negotiable
  **#6, #7, #8** of entry 8, or #11–#13 if entry 7's block is counted first. Neither ordering gives
  3rd/5th. [?] LoadFetcher may render or number its own list differently.

### 9.3 Who sent them (Q2) — Amazon's own code, through a fetch wrapper

Every chat request (3, 4, 12, 13, 17) has `_initiator.type: "script"` and this stack (entry 3):

```
window.fetch        chrome-extension://ihcg***/main.js                 0:166736   ← wrapper
window.fetch        chrome-extension://ihcg***/mainComponent.bundle.js 320:1243424 ← wrapper
getSessionHistory   d2rgidlsfg8vnm.cloudfront.net/446-c977….js        5:1663954  ← Amazon chat
  [await] (anon) 446-….js 5:1679887 < (anon) 446-….js 5:1680673
  < ap 1858:93234 < vb 1858:113187 < (anon) 1858:109842 < q 1884:1636 < S 1884:2168   (m.media-amazon.com …?name=vendor)
```

Entry 4 is the same with `sendMessage` 446-….js 5:1666080 < `A` 5:1679394. Entries 12 and 17 are
the same, rooted at `Fr 1858:46875 / qb / ub` instead of `q/S`.

🔑 **The two chrome-extension frames are LoadFetcher's `window.fetch` monkey-patches, not the
caller.** Our own `networkObserver.js:1095` sits in exactly that top position on every chat request in
`ai-chat.har` (entries 4, 5, 20, 21, 35, 36). Under the wrappers, every frame is Amazon's: chat chunk 446,
then React's commit-phase effect path in `vendor` (`ap < vb < … < q < S` on the first open,
`… < qb < ub < Fr` on later opens). **These are the same vendor frames as Amazon's own icon** in
`ai-chat.har` entry 4 (first open) and entries 20/35 (later opens). So the chat requests are sent by
a `useEffect` inside Amazon's chat component when it mounts or re-renders for a load. The same
wrappers are on the token and translation fetches (0–2, 9–11, 14–16), with Amazon's
`push.9689.a` / `resolveResourcePack` in chunk `114-086e…` beneath them.

### 9.4 Requests initiated by a chrome-extension script (Q3)

- **Entry 6** is the only one. `POST relay.amazon.com/api/loadboard/search` at 02:28:03.798, stack
  `window.fetch < n < (anon)…`, all in `mainComponent.bundle.js`, with no Amazon frame.
  `sortByField: startTime`, 40 rows. **None of the three chat loads is in it.** This is LoadFetcher's
  own board query, unrelated to the chat.
- Entries 5 and 18 (`/api/ons/v1/notifications`) have `o.send@main.js` on top, which is an XHR
  wrapper, with Amazon's jQuery `ajax` below it. They are Amazon's, not LoadFetcher's.
- **No request to any non-Amazon host.** Hosts: `relay.amazon.com`,
  `cloudfront.na.api.relay.amazon.dev`, `d2rgidlsfg8vnm.cloudfront.net`.

### 9.5 What changes between the clicks (Q4)

- **No URL-borne binding.** Every URL has an empty `queryString`. The `referer` is
  `https://relay.amazon.com/loadboard/search` on every relay.amazon.com request (2, 5–8, 11, 16, 18),
  and `https://relay.amazon.com/` (origin-trimmed) on every cross-origin compass call. A HAR records
  no `pushState` or hash change, and none is visible.
- **No request carries the load id before the chat's own `sessions/…/events`.** The id first appears
  in entry 3, 12 or 17's URL (checked across all request URLs and bodies). The only earlier mention of
  `e3f0`/`7443`/`a5d1` is in the *response* of Amazon's board search, entry 8.
- **Per open, Amazon's app runs the same four steps:** it re-reads translations, calls `GET /api/token`,
  then `sessions/{neg-…-<loadId>}/events`, then `chat/stream` `auto_start`. This is a fresh chat mount
  per load.

### 9.6 Was the export filtered? (the "-day -font -pendo -28a" filter)

- The four text terms match **0 URLs** in `ai-chat.har` and `ai-chat-2.har`, so on their own they
  would remove nothing seen before.
- ⚠ **This export holds only `fetch` (17) and `xhr` (2).** The two earlier captures had `ping`
  (22 / 45 `unagi.amazon.com`) and `script` (3 / 3 chunks). A 40-second session on the board with no
  `unagi` beacon is unlikely, so **a resource-type filter (Fetch/XHR) was probably also active, and
  the export followed it** [?]. What that could hide: a document or navigation entry, chunk-446's
  own load (`script`), any WebSocket, and any `ping` or `other` request LoadFetcher makes. It cannot
  hide a `fetch` or `xhr`.

### 9.7 Mechanism (Q5)

**(b) LoadFetcher drives Amazon's own chat UI, and Amazon's code sends every chat request.**
- ✅ **Proven** (9.3): the callers are chunk 446's `getSessionHistory` / `sendMessage`, invoked from
  React effects, with the same vendor frames as Amazon's own icon. LoadFetcher appears only as a
  fetch wrapper, and it made no compass or demand-support call itself (9.4).
- ✅ **Proven:** the load binding is the `sessionId` and `entityIdentifiers.workOpportunityId` that
  Amazon's client builds, and nothing in the network precedes it.
- ⚠ **[?] How the component gets the chosen load is not in the HAR.** A call stack through React's
  scheduler loses the click that caused it. Candidates, none of them tested: a programmatic `.click()`
  on Amazon's per-card assistant control (which may exist without the card being expanded), a
  dispatched DOM or custom event, or writing to React props or state through the fiber.

### 9.8 The one next step that would prove it (Q6)

**Read LoadFetcher's installed source. It is static, and no request is sent.** Copy
`mainComponent.bundle.js` (and `main.js`) from
`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions\ihcg…\<version>\` into `samples/`. Then
search them for the AI button's handler: `demandSupport`, `RLB-RA`, `auto_start`, `.click(`,
`dispatchEvent`, `__reactFiber` / `__reactProps`, `compass`. Whatever that handler touches is the
mechanism. If it is minified beyond reading, the fallback is a live DevTools step: an Event Listener
Breakpoint on `Mouse › click`, then click LoadFetcher's AI button and step until chunk 446 is
reached.

---

## 10. LoadFetcher's source — how "Open AI Chat" binds Amazon's chat to a chosen load

**Source:** LoadFetcher 3.23.9 (`"name": "LoadFetcher - Relay Amazon Efficiency Booster"`, id
`ihcg***`), copied read-only from `Chrome\User Data\Default\Extensions\ihcg…\3.23.9_0\` to
`samples/competitor-ext/`. `samples/` is gitignored (`.gitignore:8`, checked with `git
check-ignore`). Only the extension folder was read in User Data. No request was sent. **We are
learning the mechanism only; none of this code goes into our extension.**

Offsets are byte offsets from `grep -b`. `main.js` is a single line, so offset = column.

### 10.1 Two worlds: the button in React, the action in page JS

`contentScript.bundle.js` (407 bytes, the whole file) injects both bundles into the **page's main
world** with `<script>` tags:

```js
// contentScript.bundle.js (de-minified)
if (!document.getElementById("myScript")) {
  const s = document.createElement("script");
  s.id = "myScript"; s.src = chrome.runtime.getURL("main.js"); s.type = "module";
  document.body.appendChild(s);
}
const s2 = document.createElement("script");
s2.src = chrome.runtime.getURL("mainComponent.bundle.js");
(document.head || document.documentElement).appendChild(s2);
```

Both files are `web_accessible_resources` for `relay.amazon.com` (manifest l.32–35). This is why the
HAR (§9.3) shows `main.js` and `mainComponent.bundle.js` as main-world `window.fetch` wrappers.
- ✅ The chat-opening code is in `main.js`, which is injected only via that `<script>`, so it runs in
  the **main world**. It has to: `__reactFiber$…` expandos on Amazon's DOM nodes are not visible
  from an isolated content-script world.
- `mainComponent.bundle.js` is *also* listed under `content_scripts` (manifest l.12), so it runs in
  both worlds. It bundles its **own** React. Its `__reactFiber$` at offset 774247 is React-DOM's own
  internals (`_n="__reactFiber$"+cn`), not a hook into Amazon.

### 10.2 The button, and which cards get it (Q1)

`mainComponent.bundle.js` line 597, component `kb` (LoadFetcher's per-load panel), offset ~16715866:

```js
// de-minified
const { token } = useLoadFetcherAuth();              // m
const showAi = !!token && !subscription?.isExpired  // w = !(!m||N) && e?.demandSupportEnabled
               && load?.demandSupportEnabled;
...
showAi && <span title="Open AI chat for this load"
   onClick={() => window.postMessage(
       { type: "LOADFETCHER_OPEN_AI_CHAT", payload: { loadId: load?.id } }, "*")}>
   Open AI Chat</span>
```

- **The field is `demandSupportEnabled`**, taken from Amazon's `/loadboard/search` rows. The same
  field in §9.2 marks exactly the 8 negotiable rows of entry 8. The loads LoadFetcher keeps in its
  store (`main.js` ~170279) copy `demandSupportEnabled` from the search row. Its DOM fallback
  (`mainComponent` ~732020) sets `demandSupportEnabled: !!card.querySelector(".ai-tag")`.
- Gates besides that field: a LoadFetcher login token and a subscription that has not expired.
- **Where the panel appears:** `ub` portals `kb` into `document.getElementById(load.id)`, which is
  Amazon's card node whose id is the work-opportunity id. It does this for each load in state list
  `g`. `g` is toggled by `LOADFETCHER_LOAD_COLLAPSE`, which `main.js` (~154946) posts when a click
  lands inside Amazon's `.load-card__selected` / `.wo-card`, and also when its refresher detects a
  new load. [?] The code does not settle whether that counts as "expanded" in Amazon's UI. It is
  Amazon's *selected* card that gets the panel, not Amazon's details sheet. There is exactly one
  "Open AI Chat" button in the whole extension (1 occurrence).

### 10.3 The click handler: writes Amazon's React context state (Q2)

`main.js` offset 154172 receives the message:

```js
window.addEventListener("message", ev => {
  ...
  else if (ev.data.type === "LOADFETCHER_OPEN_AI_CHAT") {
    const loadId = ev.data?.payload?.loadId;
    loadId && openAmazonChat(loadId);                  // O(A)
  } ...
```

`main.js` offsets 159388–160620, `O` de-minified (constants resolved from offset 159388:
`k="__reactFiber$"`, `T="return"`, `K="child"`, `L="sibling"`, `R="memoizedProps"`,
`J="dependencies"`, `Z="firstContext"`, `x="memoizedValue"`, `N="next"`):

```js
const fiberOf = el => el && el[Object.keys(el).find(k => k.startsWith("__reactFiber$"))];
function openAmazonChat(loadId) { try {
  // 1. find the React root: fiber of <body> (or first DOM node with one), walk .return to the top
  let f = fiberOf(document.body) ?? firstNodeWithFiber(); while (f?.return) f = f.return;
  // 2. DFS over child/sibling; on each fiber read its CONTEXT dependencies:
  //    fiber.dependencies.firstContext → .memoizedValue, following .next
  //    pick the context value v with v.chatBotState && typeof v.setChatBotState === "function"
  //    (prefer one whose chatBotCandidateList is non-empty)
  const ctx = findChatBotContext(root);  if (!ctx) return;
  // 3. the work opportunity: by id in ctx.chatBotCandidateList, then ctx.workOpportunityList;
  //    else from getElementById(loadId) walk fiber.return ≤60 levels, scanning memoizedProps for
  //    an object with .id === loadId && Array.isArray(.loads)
  const wo = find(ctx.chatBotCandidateList, loadId) ?? find(ctx.workOpportunityList, loadId)
             ?? propsSearchUp(document.getElementById(loadId), loadId);  if (!wo) return;
  // 4. write Amazon's chat state and call Amazon's own setter
  const s = ctx.chatBotState;
  s.workOpportunityForDemandSupport = wo;
  s.setIsChatBoxOpen = true;
  s.setShowBadgeOnIcon = false;
  ctx.setChatBotState(s);
} catch {} }
```

🔑 **So the answer is "writes React state", through a setter that Amazon's own app exposes in a
React Context value.** Nothing is clicked. No DOM event is dispatched and no Amazon global is
called. Nothing sends a request, and nothing touches URL/history. The load is picked **by id**, which
is why any negotiable load works in any order. Amazon's "steps through negotiable loads in order"
behaviour (§5 and the earlier finding) belongs to its own icon, which reads `chatBotCandidateList`
in order [?]. LoadFetcher sets `workOpportunityForDemandSupport` directly.

⚠ **[?]** It mutates the *same* `chatBotState` object and passes it back. A plain `useState` setter
would bail out on an identical reference. That it still re-renders means Amazon's
`setChatBotState` is not a plain setter, or something else in the render path forces an update.
The HAR proves the open happened (§9.2); the code does not show why the identical reference works.

### 10.4 What it relies on (Q4)

- **React internals:** the `__reactFiber$` prefix on DOM nodes, and fiber fields `return`, `child`,
  `sibling`, `memoizedProps`, `dependencies.firstContext.memoizedValue` / `.next`.
- **Amazon context shape (field names):** `chatBotState`, `setChatBotState`, `chatBotCandidateList`,
  `workOpportunityList`, and inside the state `workOpportunityForDemandSupport`, `setIsChatBoxOpen`,
  `setShowBadgeOnIcon`. The work-opportunity object must have `id` and `loads[]`.
- **Amazon DOM:** the card element `id` = work-opportunity id (`getElementById(loadId)`),
  `.load-card`, `.load-card__selected`, `.wo-card`, `.wo-total_payout`, `.ai-tag` (the negotiable
  marker), `.wo-card-header__components`, `#selected-work-sheet`. It also styles
  `textarea#demand-support-chat-action-panel-input` and `.chatbot-body` (dark-mode CSS only).
- **Page messaging:** `window.postMessage` with `LOADFETCHER_OPEN_AI_CHAT`. No Amazon global or
  event name is used.

### 10.5 Tie to the HAR (Q5)

The click calls `postMessage`, then `O(loadId)` runs in the main world. It sets `chatBotState` and
calls Amazon's `setChatBotState` **synchronously in a `message` handler, with no network activity**.
React then re-renders Amazon's chat box, open and bound to `workOpportunityForDemandSupport`. In the
commit phase, the chat component's effect calls chunk 446's `getSessionHistory`
(`sessions/neg-…-<loadId>/events`), then `sendMessage` `HIDDEN:auto_start`. This matches every
observation in §9:
- The stacks bottom out in React's scheduler (`vendor` `ap < vb < … < q < S` / `Fr`), with no
  LoadFetcher frame. The `message` handler only queued a state update, and React ran the effect later.
- LoadFetcher shows up only as the `window.fetch` wrappers on top.
- The load id appears in no request before the chat's own. The binding is client-side React state.
- The `workOpportunityVersion` sent (182 / 127) is the one in the object LoadFetcher pulled from
  Amazon's own lists or props.

[?] Not proven by the code: that `chatBotState` lives in the component that loads chunk 446 (the
compass client) and not only the older `demand-support` client (chunk 218). The code is agnostic,
since it only writes state. Whichever chat implementation Amazon renders then does its own fetching.
