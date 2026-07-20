# Rules for Claude Code

## Working roles

* **Claude Desktop = Project Manager**: writes the prompts, tracks the project, decides sequencing. Does NOT write production code directly.
* **Claude Code = executor**: applies the prompts, writes the actual files.

## Token economy

* Do NOT request extra files or re-verify working code without a real need. If something already works, leave it alone.
* At the END of every completed step, write all changes/notes into the MD docs (CHANGELOG.md, UI\_ELEMENTS.md, BACKLOG.md as appropriate).

## Before ANY change

1. Read SPEC.md, SAFETY.md, UI\_ELEMENTS.md
2. Read CHANGELOG.md for recent changes



## After ANY change

1. Update CHANGELOG.md (date, file, what, why)
2. New UI element → add to UI\_ELEMENTS.md
3. New Amazon selector → add to AMAZON\_SELECTORS.md
4. Bug fixed → add test to TEST\_CASES.md
5. New planned feature / backlog change → update BACKLOG.md

## Code rules

1. NEVER use jQuery
2. NEVER use inline event handlers
3. Every UI element MUST have data-testid
4. Every function MUST have logger.log() at entry
5. Every catch MUST have logger.error() with context
6. NEVER use innerHTML with page data — use textContent

## Safety rules



1. Unsure about booking safety → ASK





## Verification rules

1. **PROOF BEFORE REPORT.** Never report "done" for any UI-affecting change without actually exercising the changed flow (open the page/popup, perform the user scenario, observe the result). If a flow cannot be exercised from this environment, say so explicitly in the report and list exactly what the user must test manually — never imply it was verified.
2. **SMOKE CHECKLIST** — after any UI-affecting change, run all six and report pass/fail per item:
   - (a) popup opens without console errors
   - (b) logged-out popup shows only the login block
   - (c) full login flow works (email → code → features appear)
   - (d) sidebar/panel activates on the load board
   - (e) PAT modal opens and Confirm enables with valid data
   - (f) no errors in the page console

## Communication

1. For routine changes (wiring a UI control, fixing a documented bug, applying a fully-specified prompt): implement directly, no pre-approval needed. Report what was done after, not before.
2. Plan first, wait for approval ONLY when the prompt itself explicitly says "report plan before coding".
3. Bug reported → reproduce in logs, then fix
4. After fix — explain what was wrong
5. Broke something else → say so immediately

## Правило завершення задачі

Після кожної виконаної задачі, перед завершенням сесії:

1. Додай запис у CHANGELOG.md (що зроблено + дата).
2. Онови BACKLOG.md (познач виконане, додай нове, що випливло).
3. Перепиши STATE.md: поточна фаза / що завершено / що в роботі / що далі / блокери.
Це про список стану проекту, а не про сам код.

