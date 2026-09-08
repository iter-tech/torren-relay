# Shipping a version — checklist

**Follow this in order for every release after 1.0.0.** It exists because three separate things
have shipped-or-nearly-shipped broken in this project for the same reason: a file the manifest
named was not where the package expected it.

---

## Where the version lives

| file | field | authoritative? |
|---|---|---|
| `manifest.json` | `"version"` | ✅ **YES — the single source of truth.** |
| `dist/tenlane-relay-<version>.zip` | the filename | derived — `scripts/build-zip.mjs` reads `manifest.version` |
| `docs/CHANGELOG.md` | the entry heading | written by hand |
| `docs/STORE_LISTING.md` | the header line | written by hand |

🔑 **Only `manifest.json` is edited.** The zip filename follows automatically. If you find
yourself typing a version number into a build script, something has gone wrong.

⚠ Chrome requires the store version to be **strictly higher** than the published one. A resubmit
after a rejection still needs a bump.

---

## The order — and the one rule that is not negotiable

### 🔑 THE CHANGELOG IS WRITTEN BEFORE THE ZIP, NOT AFTER

**Why:** the zip is the artefact you upload and then stop thinking about. A CHANGELOG written
afterwards is written from memory, by someone who has already moved on, and it is the only record
of *why* a change was made. Writing it first also forces the question "what actually changed?"
while the answer is still cheap to check.

**A version whose CHANGELOG entry is written after the upload is a version nobody can explain in
six months.**

---

## The checklist

**1. Land the code.** Every change committed. `git status` clean apart from `dist/` (ignored).

**2. Run the full regression.** All suites green, **and zero CRASHED** — a crashed suite is not a
passing suite, and this has been missed before.

**3. Re-verify the shipping constants.** Read them in `HEAD`, not just the working tree:

```
DEBUG_LEVEL          === 1        utils/constants.js
CAPTURE_RESPONSES    === false    utils/constants.js  + the MAIN mirror in networkObserver.js
CITY_ASSIGN_DEBUG    === false    utils/constants.js  + the MAIN mirror in networkObserver.js
CITY_FILTER_ENABLED  === true     utils/constants.js  + the MAIN mirror in networkObserver.js
FAST_BOOK_ENABLED    === false    utils/constants.js  (unless this release deliberately flips it)
```

⚠ **Each mirrored constant must agree with its MAIN-world copy.** A disagreement is a shipping
defect, not a style issue.

**4. 🔑 If `FAST_BOOK_ENABLED` changes, the manifest description changes in the SAME commit.**
The description's truth depends on that flag. They must never be out of step by even one commit.
Also repopulate `FORBIDDEN_SELECTORS` (`utils/constants.js:1-2`) — it is currently an empty
array, so the "never books a load" guard is disarmed and is only inert because the feature is off.

**5. Write the CHANGELOG entry.** Date, files, what, why. **Before the zip.**

**6. Bump `manifest.json` `"version"`.**

**7. Build:** `node scripts/build-zip.mjs`

**8. Read the script's output.** It refuses to build on any failure, but read it anyway —
`RESULT: all assertions passed` is the line that matters.

**9. Update the listing docs** if any user-visible behaviour changed —
`docs/STORE_LISTING.md` (description, permission justifications, screenshots) and
`docs/PRIVACY_POLICY.md` if data handling changed at all.

**10. Load the unzipped `dist/stage/` in a CLEAN Chrome profile.** Popup opens, sign-in works,
the board activates. ⚠ **No assertion in the build script can replace this** — it is the only
proof that the package runs.

---

## What the build script asserts for you

`scripts/build-zip.mjs` derives its file list from `manifest.json` **and from every HTML page the
manifest references** — it is never hand-maintained. It refuses to produce an archive unless:

- every path the manifest references exists **on disk**;
- the nine required files are staged (`manifest.json`, `background.js`, the four icons,
  `utils/supabaseConfig.js`, `popup/popup.html`, `vendor/html2canvas.min.js`);
- no excluded path is present (`samples/`, `docs/`, `dist/`, `scripts/`, `node_modules/`, `.git/`,
  `*-suite.mjs`, root `*.md`, `.gitignore`, and the two stray temp folders);
- and then, **reading the finished zip back**: `manifest.json` is at the archive root, entry names
  use forward slashes, every referenced file is inside, and nothing excluded is.

⚠ **What it does NOT check:** that the extension runs. It checks that the package is complete and
well-formed — nothing more. Step 10 is not optional.

🔑 **Following an HTML page's own `src`/`href` is the step that matters most.**
`utils/supabaseConfig.js`, `popup/popup.js` and `popup/popup.css` are reachable only through
`popup.html`. **`supabaseConfig.js` is the file whose absence breaks sign-in with no visible error
on the board** — `authGate.js` logs at `logger.warn`, which is silenced at `DEBUG_LEVEL 1`.
