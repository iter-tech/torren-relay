# Chrome Web Store — submission copy

**Prepared 2026-09-02 for version 1.0.0.** Every field below is paste-ready.

Each justification is grounded in a `file:line` that was read and verified. Anything that could
not be verified from source is marked **TO CONFIRM** rather than asserted — a justification that
does not match the code is a rejection.

---

## 1. Single purpose statement

> Tenlane Relay monitors the Amazon Relay load board for a signed-in dispatcher and surfaces newly
> posted loads — alerting, filtering and detailing them — so the dispatcher can act on them in
> Amazon's own interface.

**How each shipped feature serves that one purpose:**

| feature | serves the purpose by | verified at |
|---|---|---|
| Board refresh | keeping the board current so new loads appear | `content/refreshManager.js:7` |
| New-load detection | identifying which loads are new | `content/loadDetector.js:7` |
| Sound alert | surfacing a new load when the tab is not being watched | `content/soundAlert.js:59` |
| Tab alert | same, in the tab title/favicon | `content/tabAlert.js:148` |
| Auto-open top new load | surfacing the newest load without a manual click | `content/detailOpener.js:301` |
| Per-origin-city filtering | surfacing only loads from cities the dispatcher works | `content/cityAssign.js:1681` |
| Inline load panel | showing that load's details in place | `content/inlinePanel.js:1376` |
| Post-a-Truck prefill | acting on the board in Amazon's own form | `content/patModal.js:917` |

⚠ **ONE HONEST RISK, worth knowing before a reviewer raises it.** Post-a-Truck is the weakest fit:
it *posts* truck availability rather than surfacing a load. It is defensible as "acting on the
board in Amazon's own interface" — it only prefills Amazon's existing form and submits to Amazon's
own endpoint (`content/patApi.js:6`, a **relative** path, so nothing leaves Amazon's origin) — but
a strict reviewer could read it as a second purpose. **If challenged, the honest answer is that it
prefills an Amazon form from data already on the page, and adds no new destination.**

---

## 2. Short description

Must match `manifest.json` exactly. **126 characters.**

```
Monitors the Amazon Relay load board, alerts you to new loads, filters by origin city, and streamlines your dispatch workflow.
```

---

## 3. Detailed description

```
Tenlane Relay is a tool for freight dispatchers working the Amazon Relay load board.

It watches the board while you work and tells you when something new appears, so you do not
have to keep refreshing and re-reading the list yourself.

What it does

- Refreshes the load board on an interval you set, and shows the countdown to the next refresh.
- Detects which loads are new since the last refresh and highlights them.
- Plays a sound when a new load appears. You choose the sound and the volume.
- Flashes the browser tab when a new load appears while you are working in another tab.
- Opens the newest load automatically, so its details are on screen when you look back.
- Filters the board by origin city. Add the cities you run from and switch between them; the
  count of loads for each city is shown on its button.
- Shows an inline detail panel under a load: stops, timings, distance, equipment and payout,
  built from the same data the Amazon page has already loaded.
- Prefills Amazon's Post-a-Truck form from the load you are looking at, so you can post truck
  availability without retyping the route and times.

What it does not do

- It does not book loads. Booking is done by you, in Amazon's own interface.
- It does not change the loads on the board, hide loads it cannot identify, or alter what
  Amazon shows you beyond the panel and highlighting described above.
- It does not run anywhere except the Amazon Relay load board.

You need an Amazon Relay account to use the board, and a Tenlane Relay account to use the
extension. The extension never sees your Amazon credentials.
```

⚠ **Fast Book is NOT described.** It is gated off in this build by `FAST_BOOK_ENABLED = false`
(`utils/constants.js:144`), and the button is never created (`content/inlinePanel.js:858`).
**Do not add it to the listing until that flag flips — and if it flips, this section and the
"does not book loads" line must change in the same release.**

---

## 4. Permission justifications

### `storage`

```
The extension stores the dispatcher's own settings — refresh interval, chosen alert sound and
volume, origin cities, night mode, and which alerts are enabled — using chrome.storage.local, so
they persist between sessions. It also stores the sign-in session token there so the dispatcher
is not asked to log in again on every page load. No load data and no browsing information is
stored.
```
**Verified:** settings write `popup/popup.js:507`; session write `utils/authGate.js:54`.

### `clipboardWrite`

```
The load panel has a camera button that copies a picture of the load card to the clipboard, so a
dispatcher can paste it into a message to a driver. The image is generated in the page and
written with navigator.clipboard.write. Nothing else is written to the clipboard, and the
clipboard is never read.
```
**Verified:** button wired at `content/inlinePanel.js:1469`; the write at `:752`
(`new ClipboardItem({ 'image/png': blob })`). ⚠ **It copies an IMAGE, not text** — say image, not
"load details", or the justification will not match the behaviour.

### `host_permissions` — the 11 `relay.amazon.*` domains

```
The extension's entire function is on the Amazon Relay load board, so it needs to run there. The
eleven domains are Amazon's regional Relay sites; a dispatcher's account belongs to one of them,
and the extension behaves identically on all eleven. Within those domains it only activates on
the load board itself — on any other Relay page it does not run.
```
**Verified:** the eleven are in `manifest.json` `host_permissions` and both `content_scripts`
blocks (exact set, checked programmatically). The load-board restriction is
`isLoadBoardPage()`, `utils/constants.js:184`, composed into the activation gate at
`utils/authGate.js:92`.

### `host_permissions` — `*.supabase.co`

```
Supabase is the extension's sign-in provider. The extension contacts it only to send the
dispatcher's email address, verify the one-time code, and refresh the session token. No load
data, settings or usage information is sent there.
```
**Verified:** client created at `utils/authGate.js:16` and `popup/popup.js:42`. The only calls in
the codebase are `signInWithOtp`, `verifyOtp`, `setSession`, `refreshSession`, `signOut` — audited
across `utils/` and `popup/`, with no other Supabase call of any kind.

---

## 5. Data use disclosure — Privacy practices form

**Data types to declare:**

| type | declare? | why |
|---|---|---|
| Personally identifiable information | ✅ **YES** | the email address used to create the account |
| Authentication information | ✅ **YES** | the sign-in session token |
| Location | ❌ no | the extension reads load coordinates from Amazon's response to place loads on the board; it never reads the user's location |
| Web history | ❌ no | nothing about browsing is recorded or sent |
| User activity | ❌ no | no clicks, page views or usage are transmitted |
| Website content | ❌ no | Amazon page content is read to display it back to the dispatcher and is never transmitted |
| Financial / health / personal communications | ❌ no | none is touched |

**The three certifications — all three can be truthfully checked:**

1. **Not being sold to third parties** ✅ — nothing is sold; there is no third-party recipient
   other than the auth provider.
2. **Not being used or transferred for purposes unrelated to the single purpose** ✅ — the only
   transfer is sign-in.
3. **Not being used or transferred to determine creditworthiness or for lending** ✅.

**Privacy policy URL:** `https://iter-tech.github.io/torren-relay/`

✅ **VERIFIED LIVE 2026-09-02** — returns **200**, as does the repository behind it
(`github.com/iter-tech/torren-relay`). ⚠ Reachability is confirmed; **the page CONTENT was not
verified** from here — open it once and check it renders the policy itself and not a README or a
placeholder. **A 200 serving the wrong page is still a rejection.**

### ⚠ TWO MISMATCHES TO RESOLVE BEFORE SUBMITTING — flagged, not smoothed over

**A. ✅ RESOLVED 2026-09-02 — the URL is live.** The GitHub organisation moved to **`iter-tech`**
and the policy is now served at `https://iter-tech.github.io/torren-relay/`, which returns
**200**.

⚠ **This was previously the single most likely cause of rejection** — the old URL under
`igorpol114-ship-it` returned 404, and so did the repository behind it. It is now closed.

⚠ **One thing still unverified:** reachability was confirmed, **the page content was not**. Open
it once and confirm it renders the policy and not a README. A 200 serving the wrong page is still
a rejection.

**B. The policy discloses a third party this form does not obviously cover — Google.** The load
panel's route button opens Google Maps with the load's stop names and addresses in the URL
(`content/inlinePanel.js:790-801`). The privacy policy states this plainly. It is **user-initiated
navigation, not a data transfer by the extension**, so the "not sold or transferred" certification
still holds — but the two documents must not appear to disagree. **If the form has a free-text
box, say so there in one line.** Suggested wording:

> The extension has a button that opens the current load's route in Google Maps. Pressing it
> navigates the user's own browser to Google with the stop addresses in the URL. Nothing is sent
> to Google otherwise.

---

## 6. Screenshot shot list — 1280×800

⚠ **Applies to EVERY shot — check before capturing:**
- **No real carrier or company name** anywhere on the page.
- **No account email** — sign out of the popup view, or blur it.
- **No Fast Book button** (it is not created in this build, but confirm it is absent).
- **No bookmarks bar** — hide it (`Ctrl+Shift+B`) so personal links are not captured.
- **No browser profile avatar/name** in the top-right.
- Real load payouts and stop addresses are Amazon's data, not yours — **blur payout figures and
  facility codes** if you are unsure.

| # | Shot | Open this | Must show | Must NOT show |
|---|---|---|---|---|
| 1 | **The board, working** | Load board with the extension running | The top bar with the countdown and Start/Stop, several highlighted new loads | The popup; any city button carrying a real carrier name |
| 2 | **The inline load panel** | Click a load card so the panel opens beneath it | The panel: stops, times, distance, equipment, payout row | The Fast Book button (confirm absent); the detail sheet overlapping the panel |
| 3 | **Per-city filtering** | The origin-city bar with 2–3 cities added | The city buttons with their per-city counts, one city active and the board filtered to it | City names that identify a specific carrier's lanes, if that matters to you |
| 4 | **Settings** | The extension popup, **signed out or with the email blurred** | Refresh interval, sound picker and volume, alert toggles, night mode | ⚠ **The account email**; the Fast Book toggle (absent in this build — confirm) |
| 5 | **Post-a-Truck prefill** *(optional)* | A load card → Post A Truck | The prefilled form: origin/destination, radii, times, equipment | The Confirm result; anything showing a real posting was submitted |

**Four is enough** — shots 1, 2, 3 and 4 cover the single purpose. Shot 5 only helps if you want
PAT visible, and it is the feature most likely to draw a single-purpose question (see §1).

---

## 7. Notes to reviewer

```
HOW TO TEST THIS EXTENSION

This extension only does anything on the Amazon Relay load board, and only for a signed-in
user. Both are required, so please use the test account below — without it the extension is
intentionally inert and you will see a page that does nothing.

1. Install the extension.
2. Click the toolbar icon to open the popup and sign in:

     Email: torrenrelayreview@proton.me

   There is no password for the extension. Sign-in is by a ONE-TIME CODE sent to that address.
   If you need a code at any point during your review, email iterlogisticscorp@gmail.com and we
   will supply a current one immediately — usually within minutes.

3. Go to the Amazon Relay load board:  https://relay.amazon.com/loadboard/search

   NOTE: viewing the load board also requires an Amazon Relay CARRIER account, which Amazon
   issues to freight carriers and which we are not able to provision for you.

   So that this cannot block your review, we have recorded a full walkthrough showing sign-in
   and the extension working on a real load board:

       https://youtu.be/m1KnIF77u1g   (Unlisted)

   If you would prefer a live screen-share instead, email iterlogisticscorp@gmail.com and we
   will arrange one at a time that suits you.

4. On the load board, the extension adds a bar at the top of the page. Press Start. It refreshes
   the board on the interval shown and highlights loads that are new since the last refresh.

WHAT IT DOES NOT DO

- It does not book loads. Booking is done by the user in Amazon's own interface.
- It does not run on any page other than the Amazon Relay load board. On any other Relay page,
  including the Dashboard, it does not activate.
- It sends no data anywhere except our sign-in provider (Supabase), and only the email address,
  one-time code and session token needed to sign in.
```

⚠ **THE HARDEST PART OF THIS REVIEW IS STEP 3, and it is worth pre-empting.** A reviewer needs an
**Amazon Relay carrier account** to see the load board at all — that is Amazon's, not ours, and it
cannot be provisioned for them. **Expect this to be the question that comes back.** Offering a
recorded walkthrough up front, as the block above does, is the strongest available answer.

---

## Before you submit — the checklist this file cannot close

- [x] **Privacy policy published AND its content verified** — ✅ 2026-09-03, Ihor opened
      `https://iter-tech.github.io/torren-relay/` and confirmed it renders the policy. §5-A.
- [x] **Test account created and pasted into §7** — ✅ `torrenrelayreview@proton.me`, sign-in
      verified live 2026-09-03. ⚠ The password is not in this repository, by design.
- [x] **Reviewer walkthrough video recorded** — ✅ `https://youtu.be/m1KnIF77u1g`, linked in §7.
- [ ] Screenshots taken with every "must not show" item checked.
- [ ] `dist/tenlane-relay-1.0.0.zip` uploaded — 41 files, built by `scripts/build-zip.mjs`.
- [ ] The zip loaded once in a clean Chrome profile and the login flow completed.
