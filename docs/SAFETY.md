# Safety — Amazon Relay Helper

## Binding safety boundary (permanent, applies to all future features)

This extension interacts with a live commercial booking system. The following rules are non-negotiable and apply to every feature in the backlog:

- The extension CAN execute a booking sequence ONLY when the dispatcher explicitly clicks the custom 'Fast Book' UI toggle/button.
- **`isForbiddenElement()` is called before every `.click()` on Amazon's DOM.**
- None of the planned features (Night Mode, Tab Alert, Sound, Price Surge, Hide filters, Card Action Bar) add any new click site or touch booking.

Separately, `content/sidebar.js` has one click site on our own extension-owned UI (`ext-memory-indicator`, a manual dispatcher-triggered `location.reload()`). It is not Amazon DOM, carries no booking risk, and is intentionally **not** part of the "three click sites" list below — see "Allowed click sites" for the rationale.

---

## FORBIDDEN_SELECTORS (utils/constants.js)

```

```

`isForbiddenElement(el)` returns true if `el` or any ancestor matches any of these selectors. Called before **every** `.click()`.

**NEVER modify or remove these selectors.**

---

## Allowed click sites (Amazon DOM only)

This rule governs clicks on **Amazon's own page DOM**. It does not apply to clicks on
elements the extension itself injects (our own chrome) — see "Extension-owned click" below.

### Click 1 — Refresh button (refreshManager.js → refreshNow())
Three gates must ALL pass:
1. `findRefreshButton()` returns non-null
2. `isForbiddenElement(button)` === false
3. `button.tagName === 'BUTTON'`


Intent logged as `ALLOWED_CLICK_INTENTS.REFRESH`.

### Click 2 — Load card neutral zone (detailOpener.js → openTopNewLoad())
Implementation uses `scrollIntoView` + 250ms `setTimeout` + `document.elementFromPoint`:

Gates on the card container (`el`):
1. `el` exists
2. `isForbiddenElement(el)` === false  **(MANDATORY)**
3. `document.contains(el)` === true

Gates on the resolved `target` (elementFromPoint result, run inside setTimeout):
4. `target` non-null
5. `isForbiddenElement(target)` === false  **(MANDATORY)**
6. If `target` is outside `el`, fall back to `el` itself

Intent logged as `ALLOWED_CLICK_INTENTS.NEUTRAL_ZONE`.

### Click 3 — Load detail panel close (panelCloser.js → closePanelsForStart())
**Rationale:** Same as Click 3. Closing the load-detail sheet cannot trigger booking.
The detail sheet is `#selected-work-sheet`; its close button contains no booking controls.

**Safety:** `isForbiddenElement()` verifies the close button is not a booking element
before every click.

Gates:
1. `document.querySelector('#selected-work-sheet')` is non-null (panel is open)
2. `findDetailCloseButton()` returns non-null (close button found within sheet)
3. `isForbiddenElement(btn)` === false  **(MANDATORY)**

Intent logged as `ALLOWED_CLICK_INTENTS.CLOSE_DETAIL_PANEL`.
Selector strategy: see AMAZON_SELECTORS.md → Detail panel close.

### Click 4 — Fast Book sequence
Allowed to programmatically execute the booking sequence (including interacting with Amazon's DOM booking buttons) when the user interacts with the extension's explicit 'Fast Book' trigger.
---

## Extension-owned click (not subject to the rule above)

### Memory indicator (content/sidebar.js → `ext-memory-indicator`)
**2026-06-30:** Replaced the automatic memory-watchdog reload (which silently reset
Amazon's own search filters, not restorable without simulating clicks on Amazon's filter
controls — out of scope) with a manual indicator. Clicking it calls `location.reload()`
directly, dispatcher-initiated only — no automatic trigger exists anywhere in the
extension. Target is `ext-memory-indicator`, an element the extension itself created; it
is never Amazon DOM, so `isForbiddenElement()` does not apply and this click is **not**
counted among, or added to, the "three click sites" above.

---

## Network write — PAT order upsert (content/patApi.js + content/patModal.js — 2026-07-06)

The PAT feature makes a **same-origin POST** from a content script to Amazon Relay's internal
order-upsert API. This is not a click site and does not touch Amazon's DOM.

**Safety properties:**
- CSRF token always read live from `<meta name="x-owp-csrf-token">` — never captured, cached, or hardcoded.
- No `.click()` on any Amazon DOM element anywhere in this feature.
- `FORBIDDEN_SELECTORS` and `isForbiddenElement()` are not involved (no DOM clicks).
- No `innerHTML` with page data — all dynamic text via `textContent`.
- No new `manifest.json` permissions required — same-origin fetch needs only `host_permissions`.
- The dispatcher must click **Confirm** in the extension's own modal — there is no auto-submit path.
- `PAT_PAYOUT_MARKUP_RATE = 1.10` (2026-07-20, replaces the earlier flat `PAT_TEST_MARKUP_USD = 5000`): default offer = board payout × 1.10. **This is no longer an "obviously fake price" safety margin** — a 10% markup is a plausible real carrier offer, unlike the old flat +$5000. The dispatcher-must-click-Confirm gate above is now the primary safety control for this feature, not an unrealistic default price. If board payout is missing/unparseable, Payout is left **empty** (no silent fallback value) and Confirm stays disabled until the dispatcher enters a valid amount manually — see `ext-pat-payout-warning` in `content/patModal.js`.
- The POST creates a **carrier offer (truck post)**, not a booking. No load is reserved or booked.
- `FORBIDDEN_SELECTORS` booking-button rule is unrelated and must not be touched.

---

## Scope
- **Load Board (Layout A) only.** `div.load-list:first-of-type` → `div.load-card` / `div.load-card__selected` / `div.wo-card-header--highlighted`.
- Layout B (Contracts / tour-container) is intentionally ignored.

---

## Audit checklist (Stage 17)

- [ ] `isForbiddenElement()` called before every `.click()`
- [ ] No new `.click()` sites introduced by popup wiring (Step 3) or any backlog feature
- [ ] 30-minute live test on Load Board
