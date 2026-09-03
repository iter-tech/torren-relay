# Rejection playbook — Chrome Web Store review

**Written 2026-09-02, for the 1.0.0 submission.** Every answer below is drawn from this codebase
with a `file:line` that was read and verified. **Do not improvise a response** — if a reviewer
raises something not covered here, verify it in source before replying.

Each entry says: **what they would say**, **our factual answer** (paste-ready), and **whether it
needs a code change or only a form edit.**

---

## 1. "Your extension's single purpose is too broad"

**Fix type: 🟢 FORM EDIT ONLY** — unless they specifically challenge Post-a-Truck, which may need
a listing change (below).

**Answer:**

```
The extension has one purpose: to monitor the Amazon Relay load board for a signed-in dispatcher
and surface newly posted loads.

Every feature serves that purpose:
- Board refresh keeps the list current so new loads appear.
- New-load detection identifies which loads are new since the last refresh.
- The sound alert and the tab-title alert notify the dispatcher when one appears.
- Auto-open shows the newest load without a manual click.
- Origin-city filtering shows only loads from the cities the dispatcher runs from.
- The inline panel shows that load's details in place.

The extension does not book loads, does not modify the load board's data, and does not run on
any page other than the Amazon Relay load board.
```

⚠ **The weak point is Post-a-Truck**, and it is worth knowing in advance. It *posts* truck
availability rather than surfacing a load, so a strict reviewer could call it a second purpose.

**If they challenge PAT specifically:**

```
The Post-a-Truck feature does not add a destination or a capability. It prefills Amazon's own
Post-a-Truck form with data already displayed on the page the dispatcher is looking at, and
submits to Amazon's own endpoint on the same origin (a relative path, /api/loadboard/orders/upsert).
The dispatcher reviews the form and presses Confirm; nothing is submitted automatically. It is
the same action the dispatcher would otherwise perform by retyping the route by hand.
```
**Verified:** the endpoint is a **relative** path, `content/patApi.js:6`; submission happens only
from the Confirm handler, `content/patModal.js:1657`.

⚠ **If they insist PAT is a second purpose, the cheapest answer is to remove it from 1.0** rather
than argue — it is one feature, and the rest of the extension is unaffected. **That is a product
decision for Ihor, not a default.**

---

## 2. "Permission X is not justified"

**Fix type: 🟢 FORM EDIT ONLY for all four.** Every permission we request is used; none is
speculative. Paste the matching paragraph.

### `storage`

```
Used for two things. First, the dispatcher's own settings — refresh interval, alert sound and
volume, origin cities, night mode, and which alerts are enabled — are saved with
chrome.storage.local so they persist between sessions. Second, the sign-in session token is kept
there so the dispatcher is not asked to log in on every page load. No load data and no browsing
information is stored.
```
**Verified:** settings write `popup/popup.js:507`; session write `utils/authGate.js:54`.

### `clipboardWrite`

```
The load panel has a camera button that copies a picture of the load card to the clipboard, so
the dispatcher can paste it into a message to a driver. The image is rendered in the page and
written with navigator.clipboard.write. Nothing else is ever written to the clipboard, and the
clipboard is never read.
```
**Verified:** button wired `content/inlinePanel.js:1469`; the write `content/inlinePanel.js:752`.
⚠ **Say "an image", not "load details"** — it copies a PNG, and a justification that misdescribes
the behaviour is worse than none.

### `host_permissions` — the eleven `relay.amazon.*` domains

```
The extension's entire function is on the Amazon Relay load board, so it must run there. The
eleven domains are Amazon's regional Relay sites; a carrier's account belongs to one of them and
the extension behaves identically on all eleven. Within those domains it activates only on the
load board itself — on the Dashboard or any other Relay page it does not run at all.
```
**Verified:** `isLoadBoardPage()`, `utils/constants.js:184`, composed into the activation gate at
`utils/authGate.js:92`.

### `host_permissions` — `*.supabase.co`

```
Supabase is the extension's sign-in provider. The extension contacts it only to send the
dispatcher's email address, verify the one-time code, and refresh the session token. No load
data, no settings and no usage information is sent there.
```
**Verified:** client created `utils/authGate.js:16`; the only calls anywhere in the codebase are
`signInWithOtp`, `verifyOtp`, `setSession`, `refreshSession`, `signOut`.

---

## 3. "Your extension automates a third-party website"

**This is the most likely serious rejection, and the answer is strong.**

**Fix type: 🟢 FORM EDIT ONLY** — the code already supports the answer. **No change needed.**

**Answer:**

```
The extension reads the load board and displays what it finds. It does not book loads.

Booking on Amazon Relay is performed by the dispatcher, in Amazon's own interface. This build
contains a booking feature that is disabled at build time and is unreachable by any means:

1. The constant FAST_BOOK_ENABLED is false (utils/constants.js:144).
2. The button is never created or inserted into the page (content/inlinePanel.js:857).
3. The setting is removed from the extension's popup, so it cannot be switched on
   (popup/popup.js:121).
4. The function that would perform a booking refuses at its first statement, before it reads any
   part of the page (content/inlinePanel.js:392).

Each of those four is independently sufficient. There is no user setting, stored value or
console command in this build that can reach a booking action.

The three clicks the extension does perform on Amazon's page are: pressing Amazon's own refresh
button to reload the list, clicking a load card to open its details, and closing Amazon's filter
panel. None of them books anything.
```

⚠ **Do NOT claim the extension "cannot book" as a permanent property.** It is disabled in *this
build*. The honest phrasing above says exactly that, and stays true if 1.1 re-enables it.

**Verified:** all four citations read and confirmed. `content/inlinePanel.js:392` is the first
statement of `executeFastBook()` after its entry log, above every DOM read.

---

## 4. "The reviewer could not access the functionality"

**⚠ THE MOST LIKELY REJECTION OF ALL, and the one we can least fix**, because the blocker is
Amazon's, not ours.

**Fix type: 🟢 FORM EDIT** (better reviewer notes) — **plus, if they persist, a recorded video.**

**Answer:**

```
The extension is inert unless two conditions are met, both by design:

1. The user must be signed in to the extension. Without a session, no UI is created and the page
   is left untouched.
2. The page must be the Amazon Relay load board (a path containing /loadboard). On the Relay
   Dashboard or any other page the extension does not activate.

Test account for the extension:  torrenrelayreview@proton.me
There is no password — sign-in is by a one-time code sent to that address. Email
iterlogisticscorp@gmail.com and we will supply a current code immediately.

Viewing the load board itself additionally requires an Amazon Relay CARRIER account, which is
issued by Amazon to freight carriers and which we are not able to provision for you. So that
this cannot block your review, here is a full walkthrough showing sign-in and the extension
working on a real load board:

    https://youtu.be/m1KnIF77u1g   (Unlisted)

If you would prefer a live screen-share instead, tell us and we will arrange one at a time that
suits you.
```

✅ **The recording exists — `https://youtu.be/m1KnIF77u1g`, Unlisted, made 2026-09-03.** It is
already in the answer block above and in `docs/STORE_LISTING.md` §7, so the reply contains a link
rather than an offer.

🔑 **Offer the recording before they ask.** A reviewer who cannot see the feature will reject
rather than negotiate. **Have the video recorded and uploaded BEFORE responding**, so the reply
contains a link rather than an offer.

---

## 5. "Your privacy policy is insufficient / unreachable"

**Fix type: 🔴 THIS ONE NEEDS REAL WORK IF IT LANDS — and it is the most avoidable.**

✅ **As of 2026-09-02 the URL is LIVE** — `https://iter-tech.github.io/torren-relay/` returns 200.
This rejection reason should no longer apply; if it does, the URL changed again or the page is
serving the wrong content.

**If the URL 404s:** there is no answer to give — fix it and resubmit. The page content exists at
`docs/index.html`; what is missing is hosting. **Verify the URL returns 200 before responding to
anything.**

**If they say the content is insufficient**, the most likely gaps and our answers:

| what they may want | we already have it |
|---|---|
| What data is collected | Email address; the only personal data. |
| Why | Account creation and sign-in only. |
| Where it is stored | Supabase (auth provider); settings and tokens stay in the browser. |
| Whether it is sold or shared | Neither. |
| Deletion route | Email the contact address; the record is removed. |
| Third parties | Supabase (auth). **And Google**, if the dispatcher presses the route button — the load's stop addresses go into a Google Maps URL. Disclosed. |

⚠ **The Google Maps disclosure is the unusual one and reviewers do read it.** If challenged:

```
The load panel has a button that opens the current load's route in Google Maps. Pressing it
navigates the user's own browser to Google with the stop addresses in the URL, exactly as if the
user had typed them. The extension itself sends nothing to Google, and nothing is sent unless the
button is pressed.
```
**Verified:** `content/inlinePanel.js:790-801`.

---

## Before responding to ANY rejection

1. **Re-read what they actually said.** Reviewers cite a specific policy section; answer that
   section, not the general topic.
2. **Verify the claim in source before replying.** Every answer above carries a `file:line`
   because a response that does not match the code is a second rejection.
3. **If a fix is needed, ship it before replying** — bump the version, rebuild the zip
   (`node scripts/build-zip.mjs`), and say what changed.
4. ⚠ **Never claim a permanent property of the software** ("cannot ever book") when what is true
   is a property of this build.
