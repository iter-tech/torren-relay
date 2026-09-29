# "AI Chat" button — opening Amazon's Relay Assistant on a chosen load (EXT-D10)

**2026-09-28.** Built from the mechanism documented in `docs/AI_CHAT_CAPTURE.md` §10. It is our own
implementation; no LoadFetcher code was copied. ⚠ **Not verified on live Amazon.** Everything below
was proved in headless Chrome against a React mock of the documented context shape. Ihor tests it
live (§6).

---

## 1. Trace — what existed before this change

| need | where | finding |
|---|---|---|
| a. MAIN-world code + channel | `manifest.json` MAIN entry (document_start) → `content/networkObserver.js:1-19` | Wraps fetch/XHR in the page world and talks to the isolated world by `window.postMessage`. Receivers check `ev.source === window` plus a namespaced flag, e.g. `content/cityAssign.js:3629` `onCityCoordsMessage`. **Reused:** the new bridge is a second file in the same MAIN entry and uses the same postMessage channel, with a signature added (§3). |
| b. `demandSupportEnabled` per load | `content/networkObserver.js:365` `projectRecord()` → `cityAssign.js:376` `mergeLoadRecords()` → `cityAssign.js:255` `getLoadRecord(id)` | ⚠ **Not captured before.** The projection is an explicit allow-list, and the flag was not on it. **Added** at `networkObserver.js:466` as one boolean (`=== true`). It reaches the record store; the load sender's `toRow()` picks its own fields and does not ship it. |
| b. the full workOpportunity object | — | ⚠ **We do not hold it, by design.** The raw body never crosses to the isolated world (`networkObserver.js:66-81`, D7 reversed for privacy). The projection lacks `version` / `workOpportunityOptionId`, so it can never match the shape the chat needs. **Decision:** no "our captured object" fallback. The load object always comes from Amazon's own state (§2). |
| c. card UI | `content/priceSurge.js:73-83` inserts `ext-surge-badge` after Amazon's `.wo-total_payout`; `cityAssign.js:1211` `readMainCardElements()` lists `{id, el}` | The card is a place we already inject into. There was no *persistent* per-card injection, so `aiChat.paintCards()` is new. It uses the same anchor (after `.wo-total_payout`) and the same card list. |
| c. panel bottom row | `content/inlinePanel.js:806` `buildActionBar()` (camera · map · post), wired in `renderPanelFromData()` (`:1436`) | Exists as described. The hook is at `inlinePanel.js:1551`. |

## 2. How it works

```
click "AI Chat" (our button; stopPropagation — Amazon never sees a card click)
  → content/aiChat.js (ISOLATED)  sign {requestId, loadId, ts} with HMAC-SHA-256 → window.postMessage
  → content/aiChatBridge.js (MAIN) verify the signature, check freshness and replay
      1. React roots: fiber of the card node + first nodes with a __reactFiber$ key; walk to
         HostRoot and use root.stateNode.current (the committed tree, never a stale alternate)
      2. context value = { chatBotState (object), setChatBotState (function) }, found on Provider
         props or consumer dependencies; prefer one with a non-empty chatBotCandidateList
      3. load object by exact id, from Amazon's own state only, in this order:
         chatBotCandidateList → workOpportunityList → the card's own React props (≤40 levels up)
         Must have that id and a loads[] array.
      4. setChatBotState({ ...chatBotState, workOpportunityForDemandSupport: wo,
                           setIsChatBoxOpen: true, setShowBadgeOnIcon: false })   ← a NEW object
      5. 400 ms later, re-read the committed state: is it open, on that id?
  ← signed reply { ok, result, reason, source } → button "Chat opened" / "Chat unavailable"
     → logger.notice('aiChat', 'ai-chat-open', { loadId: 'abcd***', where, source, result, reason })
```

Amazon's chat component then re-renders open on that load, and **Amazon's own effect sends every chat
request** (chunk 446 `getSessionHistory` → `sendMessage auto_start`, §9.3 of the capture doc). We
send none.

**Fail-safe.** No root, no context, no setter or no load → **nothing is written to Amazon's page**.
The button says **"Chat unavailable"** for 3.5 s, and the reason is logged. There is no fallback to
clicking Amazon's UI. Reasons: `no-react-root`, `no-chat-context (roots N, fibers M)`,
`load-not-in-amazon-state`, `state-not-applied`, `busy`, `no-bridge-key`, `no-bridge-response`,
`error <Name>`.

**Which loads get the button:** only `getLoadRecord(id).demandSupportEnabled === true`, and only while
signed in (`isAuthGateActiveSync()`). No record, `false`, or a missing field all mean no button.

**Phrase hook:** `aiChat.onChatOpened(fn)` calls `fn(loadId)` after a *confirmed* open. The phrase
panel will register there and call `phrases.phrasesForLoad(loadId)`. Nothing registers yet.

## 3. Why the message is signed, and how the key is exchanged

`window.postMessage` is broadcast. The page and every extension see every message, and `ev.source` is
`window` for all of them. So "came from our content script" cannot be checked by origin.
LoadFetcher posts its own `LOADFETCHER_OPEN_AI_CHAT` on the same window.

- `content/aiChatKey.js` (ISOLATED, **document_start**) makes a 32-byte secret. It hands it to the
  bridge (MAIN, document_start) in the `detail` of one synchronous `CustomEvent`. At that moment no
  page script exists, so no page listener can exist. Whichever half runs second completes the
  exchange (hello/key/ack). **Neither half takes part once any page `<script>` exists.**
- Every request is signed over `open\nrequestId\nloadId\nts`, and every reply is signed too. The
  bridge rejects a missing, zero or wrong signature, a timestamp older than 15 s, and any `requestId`
  it has already seen.
- Two things the proof caught and fixed: (1) at document_start `document.documentElement` is still
  **null**, so the first design (an attribute on `<html>`) could not work; (2) a late-running copy of
  the key script **answered a page's `hello` with the key**. Now it answers nothing once page scripts
  exist.

## 4. Proof — headless Chrome, `scripts/aichat-suite/run.cjs`, **49 / 49 PASS**

Real files, real world separation: `aiChatBridge.js` in the page world at document start, and
`aiChatKey.js` in an isolated world at document start (CDP `worldName`, the mechanism content
scripts use). Then `designTokens`, `constants`, `logger`, `aiChat.js` and the real `inlinePanel.js`
in that isolated world. Stubbed: `getLoadRecord`, `readMainCardElements`, `isAuthGateActiveSync`.
The page is React 18.3.1 with a Provider value `{chatBotState, setChatBotState,
chatBotCandidateList, workOpportunityList}`, plus a chat component whose effect stands in for
Amazon's. Served from 127.0.0.1; no request to Amazon.

Run twice, once with each world first:

| check | result |
|---|---|
| key exchange done before page scripts | ✅ both orders |
| card button only on the 5 `demandSupportEnabled` loads of 6 | ✅ |
| click **3rd** eligible → state = that load, open; effect ran; card **not** selected; "Chat opened" | ✅ source `amazon-candidate-list` |
| click **5th** eligible → same | ✅ source `amazon-card-props` |
| then 4th, then 1st (any order) | ✅ `amazon-wo-list`, `amazon-candidate-list` |
| other state fields kept (`untouchedField: 'kept'`), badge flag off | ✅ |
| page sees our 4 signed requests, and still cannot use them | ✅ |
| forged: zero signature · exact replay · genuine sig with swapped load · genuine sig with new requestId · `LOADFETCHER_OPEN_AI_CHAT` → **state unchanged** | ✅ |
| page sends `hello` after load → **no key**; page plants its own key and signs with it → **rejected** | ✅ |
| panel row (real `buildActionBar()`): "AI Chat" after camera/map/post, `ext-action-btn` class; absent on a non-negotiable load; click opens that load | ✅ |
| **no context** on page → "Chat unavailable", reason `no-chat-context`, page DOM identical, card not selected, label back to "AI Chat" | ✅ |
| no page errors | ✅ |

Visibility table (3 loads):

| load | demandSupportEnabled | button |
|---|---|---|
| 0a1b*** | true | **yes** |
| 1c2d*** | false | no |
| 2e3f*** | (field absent) | no |

`node scripts/build-zip.mjs`: **all assertions passed, 50 files** (3 new). `FAST_BOOK_ENABLED` is
still `false` (`utils/constants.js:152`). The new code contains no `.click()` and no
`fetch`/XHR. Its only booking-related selector is our own `ext-action-fastbook` testid, read at
`aiChat.js:231` purely to place AI Chat before it. That button does not exist in this build, and
nothing clicks it.

**Not proved, and only live Amazon can prove it** `[?]`: that Amazon's real context value, lists and
field names match §10 today; that the context and the card share a findable React root; that Amazon's
card does not select on `pointerdown` before our `stopPropagation` (the mock selects on click); and
that the real chat renders from this state.

## 5. Fragility (also in DECISIONS.md EXT-D10)

It depends on React internals (`__reactFiber$`, fiber `return` / `child` / `sibling` /
`memoizedProps` / `dependencies.firstContext.memoizedValue` / `stateNode.current`) and on Amazon's
field names (`chatBotState`, `setChatBotState`, `chatBotCandidateList`, `workOpportunityList`,
`workOpportunityForDemandSupport`, `setIsChatBoxOpen`, `setShowBadgeOnIcon`, `demandSupportEnabled`).
A rename breaks it **to "Chat unavailable"**, never to a wrong load: every match is by exact name and
id.

## 6. Ihor's live test — LoadFetcher OFF

1. Open `chrome://extensions`. On **LoadFetcher**, turn the toggle **off**.
2. On **Tenlane Relay**, click the reload icon (↻).
3. Open `https://relay.amazon.com/loadboard/search` and press **F5**. The page must be reloaded after
   step 2, because the new scripts start with the page.
4. Press **F12** and open the **Console** tab.
5. Look at the load cards. Every card that shows Amazon's AI tag must have a blue **AI Chat** button
   right after the price. Cards without the AI tag must have **no** button. Take a screenshot.
6. Count the cards that have **AI Chat**. On the **3rd** one, click **AI Chat**, the button itself
   and not the card. Expected: Amazon's Relay Assistant opens on **that** load (check the route and
   price in the chat), and the button reads **"Chat opened"** for about 3 seconds. The card must
   **not** become selected.
7. Close the chat. On the **5th** card with **AI Chat**, click **AI Chat**. Expected: same, on the
   5th load.
8. Click the **3rd** card again to open our panel under it. In the panel's bottom row (camera, map,
   post, **AI Chat**), click **AI Chat**. Expected: the chat opens on that load.
9. **Do not type in the chat and do not click Book.**
10. In the Console, copy every line containing **`ai-chat-open`** (one per click; each shows
    `source`, `result` and, on failure, `reason`).
11. If any click showed **"Chat unavailable"**: in the Console's context dropdown (top-left, it says
    `top`), choose **Tenlane Relay**, type `__EXT_DEBUG.aiChatLog()` and press **Enter**, then copy
    the table.
12. Send the screenshot and the copied lines to the PM. Turn LoadFetcher back on afterwards if you
    want it.
