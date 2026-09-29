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
      1. React roots: the page's first node with a __reactFiber$ key, then the card's, then others;
         walk to HostRoot and use root.stateNode.current (the committed tree)
      2. context value = { chatBotState (object), setChatBotState (function) } that a rendered
         component CONSUMES (fiber.dependencies) — sibling-first DFS, first one with a non-empty
         chatBotCandidateList. Provider-only values are counted, never chosen.        [EXT-D10.1]
      3. load object by exact id, from Amazon's own state only, in this order:
         chatBotCandidateList → workOpportunityList → the card's own React props (≤60 levels up,
         must have loads[])
      4. refuse if setIsChatBoxOpen / setShowBadgeOnIcon hold a function; otherwise set
         workOpportunityForDemandSupport, setIsChatBoxOpen = true, setShowBadgeOnIcon = false
         ON AMAZON'S OWN chatBotState OBJECT, and call setChatBotState(thatSameObject) [EXT-D10.1]
      5. poll up to ~1 s: consumed state open on that id AND Amazon's chat panel visible
         (.chat-box-position / .chatbot-body / .bot-header / #demand-support-chat-action-panel-input)
  ← signed reply { ok, result, reason, source, diag } → "Chat opened" only if BOTH held, else
     "Chat unavailable" with result set-not-applied / unavailable
     → logger.notice('aiChat', 'ai-chat-open', { loadId: 'abcd***', where, source, result, reason,
        contexts, chosen, keysBefore, keysAfter, types, verify, panelBefore })
```

Amazon's chat component then re-renders open on that load, and **Amazon's own effect sends every chat
request** (chunk 446 `getSessionHistory` → `sendMessage auto_start`, §9.3 of the capture doc). We
send none.

**Fail-safe.** No root, no context, no setter or no load → **nothing is written to Amazon's page**.
The button says **"Chat unavailable"** for 3.5 s, and the reason is logged. There is no fallback to
clicking Amazon's UI. Reasons: `no-react-root`, `no-chat-context`, `no-consumed-chat-context`,
`load-not-in-amazon-state`, `open-flag-is-a-function`, `state-not-applied`, `panel-not-seen`,
`busy`, `no-bridge-key`, `no-bridge-response`, `error <Name>`. The last two of the "set" family come
with result `set-not-applied`: the setter was called and the chat did not visibly open.

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

## 6. Ihor's live test — LoadFetcher OFF (updated for EXT-D10.1)

1. Open `chrome://extensions`. On **LoadFetcher**, turn the toggle **off**.
2. On **Tenlane Relay**, click the reload icon (↻).
3. Open `https://relay.amazon.com/loadboard/search` and press **F5**. The page must be reloaded after
   step 2, because the new scripts start with the page.
4. Press **F12** and open the **Console** tab.
5. On the **3rd** card that has **AI Chat**, click **AI Chat** (the button, not the card). Watch the
   chat and the button for about 2 seconds. Write down both: did Amazon's chat open on that load
   (yes/no), and did the button say **"Chat opened"** or **"Chat unavailable"**?
6. Close the chat if it opened. On the **5th** card with **AI Chat**, click **AI Chat**. Write down
   the same two things.
7. **Do not type in the chat and do not click Book.**
8. In the Console, find the drop-down at the top-left that says **`top`**. Click it and choose
   **Tenlane Relay**.
9. Click in the Console input line, type exactly
   `copy(JSON.stringify(__EXT_DEBUG.aiChatLog(), null, 2))` and press **Enter**. This copies the log
   to the clipboard; the console prints `undefined`, which is normal.
10. Paste (**Ctrl+V**) into your message to the PM, together with your notes from steps 5 and 6.
11. Turn LoadFetcher back on afterwards if you want it.

What the log will say: `result: opened` only if the chat panel really appeared. If it did not,
`result: set-not-applied` or `unavailable`, with `reason`, `contexts` (how many chat contexts were
found), `types` (e.g. `setIsChatBoxOpen:boolean`), `keysBefore` / `keysAfter` and `verify`. These
say which step differs from what we expect. They contain field names and types only, no load data.

---

## 7. EXT-D10.1 — "Chat opened", but nothing opened (live, 2026-09-28)

**Live result, LoadFetcher OFF:** 3 clicks, each logged `where: card`, `source:
amazon-candidate-list`, `result: opened`, and the button said "Chat opened". **Amazon's chat did not
open.** On the same page with LoadFetcher ON, its button opened the chat on the chosen load. So
Amazon had not changed; our code differed from the working path.

### 7.1 The diff, step by step

Ours = `content/aiChatBridge.js` at commit `aaad6d3`. Theirs = `samples/competitor-ext/main.js`
(one line; positions are byte offsets = columns). Their code was read only to find the differences.
None of it is in ours.

| # | step | theirs | ours (aaad6d3) | cause of "setter called, chat not open"? |
|---|---|---|---|---|
| a1 | where the walk starts | fiber of `document.body`, else the first element in document order that has one, walked up `.return` to the top (~159630) | the card's fiber first, then up to 8 roots, and switches to `stateNode.current` (`:137`) | not by itself |
| a2 | which fibers can supply the context | **only `fiber.dependencies.firstContext → .memoizedValue`**, i.e. values a rendered component actually *reads* (159822) | **a Provider's `memoizedProps.value` first** (`:153`), deps second | **[?] likely.** A chat-shaped Provider that no component reads is accepted by us and never by them |
| a3 | traversal order | pushes child then sibling, so **sibling is visited first** (160066) | pushes sibling then child, so **child first** (`:167-168`) | together with a2, decides **which** value is chosen when more than one matches |
| a4 | preference | first with a non-empty `chatBotCandidateList`, else the first found (159992) | same rule, over a different candidate set | — |
| b1 | object passed to the setter | **mutates Amazon's own `chatBotState` in place**, then `setChatBotState(sameObject)` (160499–160604) | `setChatBotState(Object.assign({}, …))`, **a new object**; Amazon's object is never touched (`:232-237`) | **[?] possible.** Any component holding the old reference sees their change and not ours |
| b2 | fields written | `workOpportunityForDemandSupport = wo`, `setIsChatBoxOpen = true`, `setShowBadgeOnIcon = false`: **plain assignments of booleans; nothing is called** | same three names and values | no. ✅ Proven from code: `setIsChatBoxOpen` is a data field written as `true`, not a function to call |
| c1 | before / after the setter | nothing: no click, no event, no second call | a 400 ms wait, then a "verification" | — |
| c2 | our verification | — | re-read state through **the same finder** and require only state (`:241-243`) | ✅ **Proven from our code: this is why it said "opened".** It could only confirm our own write, wherever that write went |
| d1 | load object source | candidate list → `workOpportunityList` (id only) → card props (≤60 levels at 160331, `id` + `loads[]`) | same order; lists also required `loads[]` (`:178`), props ≤40 levels (`:38`) | no: live logged `source: amazon-candidate-list`, so our lookup succeeded |

**Cause, in one line:** we wrote a chat state that is not the one the chat panel reads (a Provider
value no component consumes, and/or a new object where the chat holds the old one), and our check
re-read that same state, so it reported success.

- **✅ Proven from code:** the false success (c2), and that we pick from a different candidate set
  in a different order (a2, a3) and pass a different object (b1).
- **[?] Which of a2/a3 or b1 was decisive on Amazon's page:** unknown. Amazon's chat code is not in
  any capture (searched every sample for `chatBotState`; only the competitor's file has it). Both
  are fixed, so neither is left to chance.

### 7.2 The fix (`content/aiChatBridge.js`)

- **a2/a3:** `scanChatContexts()` (`:173`) takes candidates **only** from `fiber.dependencies`,
  sibling-first (`:190-191`). Provider-only values are counted for the log and never chosen. Roots
  start from the page's first fiber (`:150`).
- **b1:** the three fields are set **on Amazon's own `chatBotState`**, and **that same object** goes
  to `setChatBotState` (`:297-300`). This replaces the earlier "always a new object" rule, which was
  my assumption and not the working path. A field that holds a function is **never** overwritten:
  result `open-flag-is-a-function` (`:291`).
- **c2:** success requires, within ~1 s, **both** the consumed state open on that load **and** a
  visible Amazon chat panel (`panelVisible()`, `:243`). Otherwise result **`set-not-applied`**, and
  the button says "Chat unavailable".
  ⚠ The panel selectors come from the competitor's dark-mode CSS for Amazon's chat; **we have not
  seen them live**. If they are wrong, the chat can open while we log `panel-not-seen`. That is a
  false *failure*, visible in the log, and never a false success.
- **d1:** the list lookup no longer requires `loads[]`; props walk up to 60 levels.
- **Diagnostics** in every `ai-chat-open`: `contexts` (`N consumed / M provider-only`), `chosen`,
  `keysBefore` / `keysAfter` (names only), `types` of every field used, `verify` (state yes/NO,
  which panel selector, time), `panelBefore`.

### 7.3 Proof — `scripts/aichat-suite/run.cjs`, **71 / 71 PASS**

The mock now reproduces the live failure. Besides the context the chat panel reads, the page has a
second, chat-shaped Provider that **nothing consumes** (outermost, non-empty candidate list). The
chat panel renders Amazon's classes (`.chat-box-position > .bot-header + .chatbot-body`). The real
setter re-renders on any call, as the working path requires live.

| run | result |
|---|---|
| **OLD code** (the three files from `aaad6d3`, read with `git show`) | ✅ **failure reproduced:** button "Chat opened", `result: opened`, **chat panel not open**, and the decoy holds the load |
| new: only an unconsumed context on the page | "Chat unavailable", `no-consumed-chat-context`, decoy **not** written |
| new: state applies but no panel ever renders | "Chat unavailable", `set-not-applied`, `panel-not-seen` |
| new: the previous 49 checks, both handshake orders | all pass, now also requiring a **visible panel**, an **untouched decoy** and diagnostics (`1 consumed / 1 provider-only`, `setIsChatBoxOpen:boolean`, `verify: state yes, panel .chat-box-position`) |

`node scripts/build-zip.mjs`: all assertions passed, 50 files. `FAST_BOOK_ENABLED` is still
`false`. ⚠ **Still not verified on live Amazon.** The mock models one explanation (a2); the in-place
update (b1) matches the working path, but whether it was needed is [?].
