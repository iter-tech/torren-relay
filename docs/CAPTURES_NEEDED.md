# Captures still owed — what Ihor must record, and what each unblocks

**As of 2026-09-02.** Every item below is blocked on a measurement only Ihor can take. Nothing
here can be resolved by reading source — each was already tried and the answer is not on disk.

**How to capture** (the method used for every previous capture in this project):
open DevTools → **Network** tab → tick **Offline** if the note says so → perform the action →
find the request → right-click → **Copy → Copy response** (or **Copy request**) → paste into a
file under `samples/`.

⚠ **Offline mode is used when we want the request the page BUILT but not sent** — the form
assembles the payload, the send fails, and the payload is still visible in the Network entry.
That is how the PAT upsert captures were taken.

---

## 1. 🔴 A non-`.com` load board — closes TWO items at once

**Blocks:** the radius unit (BACKLOG 0ad / PLAN 21) **and** the load-board path on ten domains
(BACKLOG 0au).

**What to do:** open the load board on **any one** non-`.com` Relay domain
(`.ca .co.jp .co.uk .cz .de .es .fr .it .in .pl`) and:

1. **Read the address bar** and send the path verbatim, or run `__EXT_DEBUG.pageGate()` and send
   the `pathname` line. *(Closes the path question.)*
2. With **Network** open, trigger a board search and **Copy request** for
   `/api/loadboard/search`. Send the `originCitiesRadiusFilters` entries. *(Closes the unit
   question — we need to see whether the radius number on a metric board is km or miles.)*

**Why it matters:** our distance maths is in **miles**. If a metric board's radius is km, every
range is ~38% short and loads land in the wrong city — silently. **This is the largest
unmeasured risk in the shipped product.**

⚠ No account? Then the honest alternative is to **narrow the manifest to `.com`** and ship US-only.
That is a one-line change and removes the risk entirely.

---

## 2. 🔴 An R-badge load — the `/search` response

**Blocks:** P/R detection (BACKLOG 0p, PLAN 8). **The R branch has never executed.**

**What to do:** find a load whose card shows an **R** badge. With **Network** open, trigger the
board search that returns it and **Copy response** for `/api/loadboard/search`. Note the load's
id so the record can be matched. **Also capture a P-badge load the same way**, from the same
response if possible.

**Why it matters:** trailer ownership currently comes from reading the badge letter off the card
DOM — an authorised interim dependency. Two labelled responses would let it come from the record
instead, and would let the R path be verified rather than assumed.

---

## 3. 🟠 A 40′ Container load, and a 53′ Reefer load — PAT upsert

**Blocks:** the two unmapped equipment enums (PLAN 8).

**What to do:** open **Post A Truck** on a load with that equipment. Tick **Offline**. Fill the
form and press **Confirm** — it will fail to send, which is the point. In Network, find the
`orders/upsert` entry and **Copy request**. Send the `equipmentTypes` and
`visibleEquipmentTypes` arrays.

**Why it matters:** `FORTY_FOOT_CONTAINER` and `FIFTY_THREE_FOOT_REEFER_TRUCK` are in
`patApi.js` but appear in no capture, so they are deliberately unmapped and route to the
unsupported-equipment modal. **It fails safe today** — PAT refuses rather than posting a guess —
so this is a coverage gap, not a defect.

---

## 4. 🟠 A "Live/Drop" load — one product decision, no capture needed

**Blocks:** BACKLOG 0k.

**Not a capture — a decision.** For a load the board labels **"Live/Drop"**, should PAT post
`["LIVE","DROP"]` or `["DROP"]`? It currently posts `["DROP"]`, derived from the record. Nothing
on disk answers which is correct: every captured upsert shows `["LIVE"]` **or** `["DROP"]`, never
both.

⚠ A second consequence to be aware of: a load the board labels **"LTL/Live/Drop"** used to make
PAT **refuse to post**; it now posts `["DROP"]`. **One word from Ihor closes this.**

---

## 5. 🟡 Four memory readings — a shift, not a capture

**Blocks:** the memory-flush feature (BACKLOG 0ap).

**What to do:** with the refresh loop running as usual, in the tab you actually work in, run
`__EXT_DEBUG.memReport()` **at the start of the shift, after 1 hour, after 3 hours, and at the
end.** Paste the four blocks.

🔑 **Watch `heapUsedMB` and nothing else.** Everything else in the report exists to say *where*
memory went once that number has been shown to move.

⚠ **If `heapUsedMB` is flat across the four readings, the feature should be dropped, not built.**
A tab reload that interrupts a dispatcher mid-shift to solve a problem that is not happening is a
net loss. The two leaks already on record cannot account for more than ~170 KB between them.

---

## 6. 🟡 The negotiation chat — which requests fire

**Blocks:** the per-load chat button (BACKLOG 0ar) and, through it, quick-phrase inserts (0as).

**What to do:** with **Network** open (no Offline), press Amazon's chat button on a load. Record:

1. **Which requests fire** — copy the request URLs.
2. **Does any of them carry a work-opportunity id?** Copy the request bodies.
3. **Does the address bar change?**

⚠ **If no load id is passed anywhere, the feature is not possible as described** — the chat would
always open on the topmost negotiable load, which is the problem it was meant to solve.
**Establish that first, before any design work.**

---

## Priority, if there is only time for one

**Item 1 (a non-`.com` board).** It is the only one that closes a **live, silent, shipped risk**
rather than unblocking a future feature — and a single session on one non-US domain answers both
halves of it.
