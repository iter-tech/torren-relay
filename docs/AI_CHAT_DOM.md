# Relay Assistant chat — what the saved DOM and the HAR show about its controls

**2026-09-25. Saved files only** — `samples/ai-chat-open.mhtml`, `samples/ai-chat-2.har`, cross-checked
against `samples/ai-chat.har`. Relay was not opened and no request was sent. Ids are masked as
`first 4 chars + ***`.

Goal behind the question (Ihor): a button on OUR load card, shown only when
`demandSupportEnabled = true`, opens Amazon's own Relay Assistant on THAT load; later a phrase panel
inserts text into the chat's input.

---

## 0. 🔴 The saved page does not contain the chat, the board or any load card

`samples/ai-chat-open.mhtml` is **not an MHTML archive**. It starts with `<!DOCTYPE html>` and
has no MIME boundary or `Content-Type:` part headers, so it was saved as **"Webpage, HTML only"**.
That saves the HTML **the server sent**, not the page as rendered.

The load board is a client-rendered app, and its mount point is empty in the file:

```
line 6702:  <div id="application"></div>
```

The file has no `workOpportunit…` string (0 matches). The only `<textarea>`/`<button>` elements
are the server-rendered feedback and support-case modals: `#feedback-text`, `#rating-btn`,
`#case-description-text`, `#menu-toggle`, …

**Consequence: every question below about elements, attributes and selectors is NOT IN DATA.** No
id, `data-*`, `aria-*`, role or class name can be quoted for the chat icon, the panel, its input or
its send button, because none of them exist in the file. The same goes for hashed class names: none
exist, so none can be flagged as fragile.

What the file does carry: the feature flags, as `<meta>` tags (lines 218–221):

```
<meta name="isDemandSupportEnabled" content="true" />
<meta name="isUnanchoredNegoSearchEnabled" content="true" />
<meta name="isDemandSupportNewUIEnabled" content="" />
<meta name="isAgentCoreNegoEnabled" content="" />
```

`isDemandSupportNewUIEnabled` is empty, so a different chat UI may exist behind that flag. **[?]**
Selectors taken from this account's UI could change when Amazon turns it on.

## 1. What the HAR proves instead — Amazon's own click telemetry

`unagi.amazon.com` beacons carry two event kinds:
- **`csa.ContentInteraction.2`**: every click, with page `interactionX/Y` and the clicked
  element's tag path (`parentChain`, tags only, no classes or ids).
- **`optimus.ClientSideEvents.6`**: named UI events, dictionary-compressed (`cs.dct` + `#n` refs).
  I decoded them offline.

Decoded ChatBot events (`ai-chat-2.har`):

| HAR entry | time | `componentType` / `subComponentType` / `actionType` | `metadata.demandAvailable` |
|---|---|---|---|
| #18 | 21:26:11.214 | `ChatBot` / `ChatIcon` / `click` | `"true"` |
| #43 | 21:28:30.872 | `ChatBot` / `cancelBtn` / `minimize` | `"true"` |
| #43 | 21:28:33.094 | `ChatBot` / `ChatIcon` / `click` | `"true"` |
| #63 | 21:29:04.064 | `ChatBot` / `cancelBtn` / `minimize` | `"true"` |
| #63 | 21:29:05.199 | `ChatBot` / `ChatIcon` / `click` | `"false"` ⚠ the chat opened anyway |
| #80 | 21:29:34.185 | `ChatBot` / `cancelBtn` / `minimize` | `"true"` |
| #104 | 21:30:56.371 | `ChatBot` / `ChatIcon` / `click` | `"true"` |

`ai-chat.har` repeats the pattern exactly: `ChatIcon` in #9, #25 and #39, `cancelBtn/minimize` in
#25, #39 and #51. All carry `rootView: "/loadboard/search"` and `pageType: "RelayLoadBoard"`, and
**none carries a load id**; the only metadata is `demandAvailable`, `carrierType` and
`searchSource`.

### The click-by-click sequence of one "next load"

The same four steps occur before every switch, in both HARs:

| step | `ai-chat-2.har` | `ai-chat.har` | what it is |
|---|---|---|---|
| a | click (1158, 436), chain `…/MAIN/…/BUTTON/SPAN/SPAN/svg`, #41 | (1166, 241), #16 | an icon button **inside the page's `<main>`**, top-right, the panel's close ✕ **[?]** |
| b | click (715, 718), chain `HTML/BODY/DIV/DIV/DIV/DIV/DIV/DIV/DIV/BUTTON/SPAN`, #41 | (717, 535), #22 | a button **outside `<main>`** (a portal overlay, i.e. a confirm dialog), logged as `cancelBtn / minimize` |
| c | click (1149, 1127), chain `…/MAIN/…/BUTTON/SPAN/SPAN/svg`, #41 | (1171, 940), #22 | **the `ChatIcon`**: same spot every time, bottom-right |
| d | `chat-history` for the **next** load **77 ms** later (#40, `wo=fbe3***`) | 70 ms later (#20, `wo=e0fe***`) | the chat is bound |

The `ChatIcon` is at the same place on every click: `ai-chat-2` (1154, 1125), (1149, 1127),
(1150, 1118) and (1145, 1116); `ai-chat` (1164, 934), (1171, 940) and (1162, 937). Viewport
1230 × 964, document height 1198 (`csa.PageInteractionsSummary.3`, #19).

**Other panel parts, by click position only:**
- **Message input:** a `<textarea>` inside `<main>`. Clicks at y ≈ 1037–1057 in `ai-chat-2`
  (#22, #27, #29, #44, #62, #103) and y ≈ 848–850 in `ai-chat` (#8, #23, #38).
- **Send button:** a `BUTTON/SPAN/SPAN/svg` to the right of the textarea, e.g. #32 at (731, 1049).
  It is followed **within 2 ms** by `query action=query` (#31, 21:28:08.829 → .831), and again at
  #48→#45, #67→#64 and #106→#105.
- **Message list and panel root:** no click landed on them. NOT IN DATA.

## 2. Answers

**1. The control that opens the Relay Assistant.** It is **one global control**, not one per card.
Amazon names it `ChatBot / ChatIcon`; it is an icon button (`BUTTON/SPAN/SPAN/svg`) at a fixed
bottom-right position, and every one of the 7 opens in the two HARs came from it. No click on a load
card precedes any `chat-history`. Element, id, `data-*`, `aria-*`, role and text: **NOT IN DATA**.
Whether cards carry a chat control of their own: **[?]** — none was used, and the DOM is missing.

**2. The open panel.** The input is a `<textarea>`; the send button is an svg icon button beside it;
closing goes ✕ (in `<main>`) → a confirm overlay (outside `<main>`) → `cancelBtn / minimize`. Root,
message list and every selector: **NOT IN DATA**.

**3. How the panel knows its load.** Not from the DOM we have. On the wire, the load is
`workOpportunityId` in the `chat-history` and `query` bodies (#13/#14, #40/#42, #59/#60, #101/#102).
The first system message states the route and pickup time as text (`"Pickup location: LEX2
(LEXINGTON, KY)"`, #14). Any DOM attribute carrying the load: **NOT IN DATA**.

**4. Can Amazon open the chat on a specific load?** From the data, **only in order.** The same
`ChatIcon` click produced four different loads, which were the `demandSupportEnabled = true` rows at
indices 0 → 2 → 9 → 18/19 of the 50-row `/search` response (see `AI_CHAT_CAPTURE.md` and the
previous analysis). The only way to advance was close → confirm → click `ChatIcon` again. A per-card
"chat about this load" control: **[?]** — not seen; the DOM needed to rule it out is missing.

**5. The simplest reliable way for our button.**
- **Proven:** clicking Amazon's `ChatIcon` opens the chat on the *next* negotiable load in board
  order, and close + confirm + `ChatIcon` advances by exactly one negotiable load (3 of 3 times in
  `ai-chat-2`, 2 of 2 in `ai-chat`).
- **Proven:** which load it bound is observable without calling Amazon ourselves. It is the
  `workOpportunityId` in the `chat-history` request Amazon's page sends 70–80 ms after the click.
- **[?] Best available plan:** if a per-card control exists, click it — one step, deterministic.
  Otherwise "open, check the bound id, close, confirm, reopen until it matches". That works only if
  the cycle is deterministic and wraps; the cost is a confirm dialog per step, and it depends on the
  board order matching our card order.
- **[?]** Whether a minimized conversation survives, and whether the cycle restarts after a board
  refresh: **NOT IN DATA**.

**6. The one capture that closes the [?]s.** With the chat **open** and several negotiable loads
visible on the board, save the page from Chrome as **"Webpage, Single File" (`.mhtml`)**. Unlike
"HTML only", Chrome serialises the **live, rendered DOM** into it. That one file answers:
- whether cards have their own chat control;
- the `ChatIcon`, panel, textarea, send, close and confirm elements with their real attributes;
- whether the panel carries the load in the DOM.

If "Single File" is not offered: DevTools → Elements → right-click `<html>` → Copy → Copy
outerHTML, pasted into a `.html` file.
