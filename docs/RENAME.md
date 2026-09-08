# Product rename — Torren Relay → Tenlane Relay

**Date: 2026-09-07.** Branch `rename/tenlane`.

| | |
|---|---|
| **Old name** | Torren Relay |
| **New name** | Tenlane Relay |
| **Occurrences found** | **76**, across 20 files |
| **Renamed (Category A)** | **54** |
| **Deferred (Category B)** | **22** |

---

## What was changed

| area | change |
|---|---|
| `manifest.json` | `name` → "Tenlane Relay"; `action.default_title` → "Tenlane Relay" |
| `utils/constants.js` | `EXT_NAME = 'Tenlane Relay'`, its comment, and the page-gate `console.warn` prefix |
| `content/cityAssign.js` | the unassigned-load tooltip, the deadhead-substitution title, and both radius `console.warn` prefixes (`[Tenlane Relay] …`) |
| `content/sidebar.js` | the signed-out play/pause tooltip |
| `popup/popup.html` | `<title>`, the header text, and the auth-gate note |
| `docs/index.html`, `docs/PRIVACY_POLICY.md` | the published privacy-policy title and body text |
| `scripts/build-zip.mjs` | the archive filename: `torren-relay-<v>.zip` → **`tenlane-relay-<v>.zip`** |
| all other `*.md` | headings and prose |

⚠ **`package.json` does not exist in this repository**, so that part of the brief did not apply.
The archive filename is produced by `scripts/build-zip.mjs`, which derives it from
`manifest.version`; only the literal prefix needed changing.

### What did NOT need changing, and why that is worth knowing

🔑 **The product name was never baked into a single machine-readable identifier.** Searches for
`torren` inside storage keys, `postMessage`/runtime message types, `data-testid` values, CSS
class/id names, and Supabase table/column/RPC names all returned **zero matches**. Nothing
persisted, nothing wire-format, and nothing test-addressable carried the brand — so **no
migration, no compatibility shim, and no risk of orphaning a stored setting.** A rename this
clean is not luck; it is what the naming discipline in this project bought.

---

## Deferred, and why — the full Category B list (22 occurrences)

**None of these was changed. Each would break something real if it were.**

### 1. The published privacy-policy URL — 9 occurrences

`https://iter-tech.github.io/torren-relay/`

`docs/CHANGELOG.md:46`, `:68` · `docs/PLAN.md:172` · `docs/RELEASE_AUDIT.md:426` ·
`docs/REVIEW_RESPONSE.md:190` · `docs/STORE_LISTING.md:162`, `:172`, `:272` · `STATE.md:30`

🔴 **This is a LIVE, PUBLISHED URL and the Chrome Web Store submission points at it.** The
`torren-relay` in it is the **GitHub repository name**, from which GitHub Pages derives the path —
so the path cannot change unless the repository is renamed, which would break the URL already
recorded in the listing. **Renaming this string in the docs would make them cite a page that does
not exist.**

**To change it later:** rename the GitHub repo, confirm the new Pages URL returns 200 **and**
serves the policy, then update the docs and the store listing in one change.

### 2. GitHub repository names — 4 occurrences

`github.com/iter-tech/torren-relay` (`docs/CHANGELOG.md:71`, `docs/STORE_LISTING.md:165`)
`github.com/igorpol114-ship-it/torren-relay` (`docs/CHANGELOG.md:277`)
`a repo named ` + "`torren-relay`" + ` / ` + "`/torren-relay/`" + ` (`docs/CHANGELOG.md:279`)

The first two name the repo that **hosts the live policy** — same reason as above. The last two
are a **dated historical record** of the 2026-09-02 diagnosis of why GitHub Pages returned 404
under the previous organisation. **Renaming a URL that was probed and recorded would falsify the
record rather than update it.**

### 3. The reviewer test mailbox — 9 occurrences

`torrenrelayreview@proton.me`

`docs/CHANGELOG.md:50` · `docs/PLAN.md:134`, `:172` · `docs/RELEASE_AUDIT.md:429` ·
`docs/REVIEW_RESPONSE.md:161` · `docs/STORE_LISTING.md:231`, `:273` · `STATE.md:33`

🔴 **This mailbox EXISTS at this address**, and its sign-in was verified live on 2026-09-03. It is
handed to the Chrome Web Store reviewer. ⚠ **This item was NOT on the brief's Category B list — it
was found during the inventory and deferred on judgement**, because renaming it in the docs would
point a reviewer at an account that cannot receive their one-time code.

**To change it later:** create the new mailbox first, verify sign-in through it, then update the
docs and the store form together.

### 4. The Chrome Web Store item id — 0 occurrences

`boioaeabnombdifjmadmlgfaaboogdlj`

**This id appears nowhere in the repository**, so there was nothing to protect. It is immutable
and is unaffected by the product name — a renamed extension keeps the same item id.

### 5 – 9. Storage keys, message types, testids, CSS names, Supabase names — 0 occurrences

All five categories were searched explicitly and **none contained `torren`**. See the note above.

---

## Verification performed

| check | result |
|---|---|
| Post-rename search | **22** remaining `torren`, **all Category B**, listed above |
| New `Tenlane` occurrences | **54** — matches the Category A count exactly |
| `manifest.json` parses | ✅ valid JSON |
| Changed JS files parse | ✅ `utils/constants.js`, `content/cityAssign.js`, `content/sidebar.js`, `scripts/build-zip.mjs` |
| Test suites | ✅ **2724 pass, 0 fail, 0 crashed** |
| Build | ✅ produces `dist/tenlane-relay-1.0.0.zip`, 41 files, **all assertions passed** |
| Archive manifest | ✅ `name` and `default_title` both "Tenlane Relay"; no `torren` anywhere in it |

⚠ **One test assertion had to be updated**, not worked around: `pagegate-suite` asserted
`action.default_title === 'Torren Relay'` and failed after the rename. That assertion exists to
prove the `action` key was added to rather than replaced when icons were wired; it now checks the
new name and still proves exactly that.

⚠ **NOT verified — there is no browser here.** The renamed build has not been loaded in Chrome.
The name appears in the popup title, the popup header, the auth-gate note, the sidebar tooltip and
four `console.warn` prefixes; **all of that is unexercised.** See the smoke items in the report.

---

## Consequences to be aware of

- ⚠ **The store listing copy in `docs/STORE_LISTING.md` now says "Tenlane Relay" while the
  published privacy policy at the live URL still says "Torren Relay"** until the updated
  `docs/index.html` is deployed to the Pages repo. **A reviewer comparing the two would see a
  mismatch.** Deploy the policy page before submitting.
- The old archive `dist/torren-relay-1.0.0.zip` remains on disk beside the new one. `dist/` is
  gitignored, so neither is committed. Deleting the stale file is safe.
