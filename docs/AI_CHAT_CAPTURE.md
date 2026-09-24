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

⚠ **[?] One figure does not match the brief:** load 3 is described as `$583.90`, and the capture's
`workOpportunity.payout` for it is **588.62** (entries 36, 41), with the assistant saying "$589".
Loads 1 and 2 match exactly (624.14, 1840.75). Not explained by the HAR — a different option or
version, or the price moved between the board render and the chat.

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

## Appendix — what is deliberately absent from this document

- No session id, load id or token value: `first-4***#fingerprint` only, with lengths and segment
  shapes where the structure mattered.
- No cookie or authorization data: the HAR carries **no `cookie` header** on any entry (checked on
  all 19 `relay.amazon.com` entries); nothing was read from any header value.
- Ihor's own typed text was three words per message (`hi chat 1/2/3`) and is quoted as such; the
  assistant's replies are quoted because they are the evidence that the right load was answered.
