# Product — Torren Relay

Product-level record: what the extension is for, and what differentiates it. Implementation
detail lives in SPEC.md; engineering plans live in BACKLOG.md.

> **New file, created 2026-08-05.** It did not exist before; the Single-Tab Multi-Driver Monitor
> entry below is its first content. Existing product framing is in `docs/SPEC.md` ("What is
> this" / "Target user"), which is unchanged.

## Today

A Chrome extension for Amazon Relay carrier dispatchers. It refreshes the load board, highlights
new loads, plays an alert, opens the top new load's detail, and helps create Post-a-Truck orders.
**The dispatcher books manually — the extension never books.**

---

## Planned — Single-Tab Multi-Driver Monitor

**Status: concept defined, data verified, nothing built. Post-launch / unscheduled.**

### What it is
One Relay tab monitors **several drivers in different regions at once**. The dispatcher configures
up to five origin cities — one per driver, each with a name they choose — and the extension runs a
single multi-origin search covering all of them. The merged results are split back out per driver
into **sub-tabs**, each with its own **new-load counter**, plus a combined **"All"** view where a
**colour stripe** identifies which driver each load belongs to.

### Why it differentiates the product
Today a dispatcher covering four drivers opens four Relay tabs, each auto-refreshing. That is not
merely inconvenient — it multiplies requests from one IP and **trips Amazon's rate limit**, which
degrades the board for everything the dispatcher is doing, including the tabs they care about
most. The existing cross-tab rate limiter in this extension mitigates that; it cannot remove it,
because the requests are genuinely multiplied.

This feature removes the cause instead of managing the symptom: **N drivers, one tab, one request
cycle.** It converts the extension's core weakness at scale into its strongest reason to choose
it — a dispatcher covering more drivers gets *more* value from it, not more throttling.

It also reframes the product. Today it is a faster pair of eyes on one board. With this, it
becomes the surface a multi-driver dispatcher actually works in, which is a materially harder
thing for a competitor to copy than highlight-and-alert.

### What is settled, and what is not
**Settled by live capture (2026-08-05):** Amazon does not tell us which searched origin matched a
load, so assignment is by **distance from the pickup's coordinates** to each configured city.
Those coordinates are present on every work opportunity, and the city coordinates already come
from the same endpoint Post-a-Truck uses.

**Not settled:** Amazon caps origins at **five**, and applies **one radius to all of them** — so
widely separated drivers share a radius, and the usability effect of that is **untested**. That
constraint should be validated with a real dispatcher before the UI is designed around it.

Full engineering detail, the five numbered findings and their provenance: **BACKLOG.md →
Single-Tab Multi-Driver Monitor**. Captured API evidence: **api-samples.md §6**.
