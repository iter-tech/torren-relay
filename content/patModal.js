// PAT Modal — extension-owned dialog for creating a truck post (carrier offer).
// Opens when dispatcher clicks ext-action-post.
// Pre-fills from the CAPTURED RECORD ONLY — getLoadRecord(loadId), the same store the inline
// panel renders from (2026-08-19). It reads NO page DOM for any field value: one work
// opportunity = one id + one block of API data, so this module keeps working when the loads are
// later served from Ihor own site where no Amazon DOM exists. Cities resolved via API call.
// Dispatcher reviews, edits numeric fields, clicks Confirm.
// Confirm POSTs via submitOrder() from patApi.js.
// NO .click() on any Amazon DOM element.
// NO innerHTML with page data — all dynamic text via textContent.
// Every interactive element has data-testid.

var PAT_MODAL_ID = 'ext-pat-modal-overlay';

// Default Payout markup: board payout × 1.10 (10%), rounded to 2 decimals. Dispatcher can
// edit the Payout field freely afterward. See PAYOUT_MARKUP_RATE usage below for the
// unparseable/missing-payout edge case — no silent fallback value is ever prefilled.
var PAT_PAYOUT_MARKUP_RATE = 1.10;

var LOADING_TYPE_DISPLAY = { 'Drop': 'Drop', 'Live': 'Live', 'Live/Drop': 'Drop & Live' };

// Distance parser for the PAT modal ONLY (2026-07-30, no-silent-fallback fix).
//
// Same normalization as patApi.js's parseNumStr ("1,233.2 mi" → 1233.2) but with a
// DIFFERENT failure sentinel: null, not 0. That difference is the entire point — a distance
// of 0 and a distance we could not read are not the same fact, and conflating them is what
// let fabricated Min/Max Miles (0/25) reach the live marketplace unflagged.
//
// Deliberately NOT a change to parseNumStr itself: that function is shared (it is also the
// payout fallback in openPostModal), and the other currency/number parsers in this codebase
// are out of scope here. Sentinel inventory for the future unification work is recorded in
// CHANGELOG.md.
//
// Returns null for: null/undefined/'' input, and any string with no leading numeric part.
// Returns a finite number otherwise — including a legitimate 0.
function parsePatMilesOrNull(str) {
  logger.log('patModal', 'parsePatMilesOrNull called', { str: str });
  if (str === null || str === undefined) return null;
  var cleaned = String(str).replace(/[$,]/g, '').trim();
  if (cleaned === '') return null;
  var n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

function injectPatModalStyle() {
  if (document.getElementById('ext-pat-modal-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-pat-modal-style';
  style.textContent =
    '#ext-pat-modal-overlay{' +
      'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.5);' +
    '}' +
    '#ext-pat-modal{' +
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:var(--ext-surface);border-radius:var(--ext-radius-card);' +
      'box-shadow:0 4px 24px rgba(0,0,0,.22);width:580px;max-width:95vw;' +
      'overflow:hidden;font-family:Arial,sans-serif;font-size:13px;' +
    '}' +
    '#ext-pat-modal .pat-header{' +
      'background:var(--ext-accent-bg);color:var(--ext-accent-text);' +
      'padding:12px 16px;font-weight:600;font-size:14px;' +
      'display:flex;align-items:center;justify-content:space-between;' +
      'cursor:grab;' +
    '}' +
    '#ext-pat-modal .pat-header-close{' +
      'background:none;border:none;cursor:pointer;color:inherit;' +
      'font-size:18px;line-height:1;padding:0 4px;' +
    '}' +
    '#ext-pat-modal .pat-body{padding:16px;display:flex;flex-direction:column;gap:10px;}' +
    /* Route row + times row share a 3-column grid */
    '#ext-pat-modal .pat-route-row,' +
    '#ext-pat-modal .pat-times-row{' +
      'display:grid;grid-template-columns:1fr 24px 1fr;gap:8px;align-items:start;' +
    '}' +
    '#ext-pat-modal .pat-route-col{display:flex;flex-direction:column;gap:6px;}' +
    '#ext-pat-modal .pat-route-arrow{' +
      'font-size:16px;font-weight:700;color:var(--ext-n400);' +
      'display:flex;align-items:center;justify-content:center;padding-top:20px;' +
    '}' +
    '#ext-pat-modal .pat-col-label{' +
      'font-size:11px;font-weight:600;color:var(--ext-n500);' +
      'text-transform:uppercase;letter-spacing:.04em;' +
    '}' +
    '#ext-pat-modal .pat-city-name{' +
      'font-weight:700;font-size:14px;color:var(--ext-n900);' +
      'min-height:20px;' +
    '}' +
    '#ext-pat-modal .pat-city-name.resolving{color:var(--ext-n400);font-weight:400;font-size:12px;}' +
    /* Stepper: [−] [MM/DD HH:mm TZ] [+] with optional datetime-local input below */
    '#ext-pat-modal .pat-stepper{display:flex;flex-direction:column;gap:4px;}' +
    '#ext-pat-modal .pat-stepper-row{display:flex;align-items:center;gap:4px;}' +
    '#ext-pat-modal .pat-stepper-btn{' +
      'width:24px;height:24px;border:1px solid var(--ext-n300);border-radius:var(--ext-radius-sm);' +
      'background:var(--ext-surface);color:var(--ext-n700);cursor:pointer;' +
      'font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;' +
    '}' +
    '#ext-pat-modal .pat-stepper-btn:hover{background:var(--ext-n100);}' +
    '#ext-pat-modal .pat-stepper-btn:disabled{opacity:0.5;cursor:not-allowed;background:var(--ext-surface);}' +
    '#ext-pat-modal .pat-stepper-val{' +
      'flex:1;font-size:12px;color:var(--ext-n900);text-align:center;' +
      'cursor:pointer;text-decoration:underline dotted;user-select:none;' +
    '}' +
    '#ext-pat-modal .pat-stepper-input{' +
      'width:100%;border:1px solid var(--ext-accent);border-radius:var(--ext-radius-sm);' +
      'padding:4px 6px;font-size:12px;background:var(--ext-surface);color:var(--ext-n900);' +
      'box-sizing:border-box;outline:none;' +
    '}' +
    '#ext-pat-modal .pat-times-warning{font-size:10px;line-height:1.3;color:#c0392b;margin-top:-4px;}' +
    /* Numbers rows */
    '#ext-pat-modal .pat-nums-a{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;}' +
    '#ext-pat-modal .pat-nums-b{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}' +
    '#ext-pat-modal .pat-num-field{display:flex;flex-direction:column;gap:3px;}' +
    '#ext-pat-modal .pat-num-label{font-size:10px;font-weight:600;color:var(--ext-n500);text-transform:uppercase;letter-spacing:.04em;}' +
    '#ext-pat-modal .pat-static-val{font-size:13px;font-weight:600;color:var(--ext-n900);padding:5px 0;}' +
    // 2026-07-30: .pat-distance-warning / .pat-stops-warning added to this selector list
    // rather than given their own rules — all three are the same "field could not be read"
    // caution line and must stay visually identical.
    '#ext-pat-modal .pat-payout-warning,' +
    '#ext-pat-modal .pat-distance-warning,' +
    '#ext-pat-modal .pat-stops-warning{font-size:10px;line-height:1.3;color:#c0392b;}' +
    '#ext-pat-modal input[type=number],' +
    '#ext-pat-modal select{' +
      'width:100%;border:1px solid var(--ext-n300);border-radius:var(--ext-radius-sm);' +
      'padding:5px 8px;font-size:13px;background:var(--ext-surface);' +
      'color:var(--ext-n900);box-sizing:border-box;outline:none;' +
    '}' +
    '#ext-pat-modal input[type=number]:focus,' +
    '#ext-pat-modal select:focus{' +
      'border-color:var(--ext-accent);box-shadow:0 0 0 2px var(--ext-accent-bg);' +
    '}' +
    /* Radius select inline with label */
    '#ext-pat-modal .pat-radius-wrap{display:flex;align-items:center;gap:6px;}' +
    '#ext-pat-modal .pat-radius-wrap select{flex:1;}' +
    '#ext-pat-modal .pat-radius-unit{font-size:11px;color:var(--ext-n500);}' +
    /* Summary + checkbox */
    '#ext-pat-modal .pat-summary{' +
      'font-size:12px;color:var(--ext-n700);padding:8px 10px;' +
      'background:var(--ext-n100);border-radius:var(--ext-radius-sm);' +
      'border:1px solid var(--ext-n200);' +
    '}' +
    '#ext-pat-modal .pat-checkbox-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ext-n700);}' +
    '#ext-pat-modal .pat-checkbox-row input[type=checkbox]{width:14px;height:14px;cursor:pointer;accent-color:var(--ext-accent);}' +
    /* Footer */
    '#ext-pat-modal .pat-footer{' +
      'padding:10px 16px;border-top:1px solid var(--ext-n200);' +
      'display:flex;align-items:center;gap:8px;background:var(--ext-n100);' +
    '}' +
    '#ext-pat-modal .pat-status{flex:1;font-size:12px;color:var(--ext-n500);}' +
    '#ext-pat-modal .pat-status-ok{color:#157347;font-weight:600;}' +
    '#ext-pat-modal .pat-status-err{color:#c0392b;}' +
    '#ext-pat-modal .pat-btn{' +
      'padding:7px 16px;border-radius:var(--ext-radius-sm);font-size:13px;' +
      'font-weight:600;cursor:pointer;border:1px solid transparent;white-space:nowrap;' +
    '}' +
    '#ext-pat-modal .pat-btn-cancel{' +
      'background:var(--ext-surface);border-color:var(--ext-n300);color:var(--ext-n700);' +
    '}' +
    '#ext-pat-modal .pat-btn-cancel:hover{background:var(--ext-n100);}' +
    '#ext-pat-modal .pat-btn-confirm{background:var(--ext-accent);color:#fff;border-color:var(--ext-accent);}' +
    '#ext-pat-modal .pat-btn-confirm:hover{background:var(--ext-accent-hover);}' +
    '#ext-pat-modal .pat-btn-confirm:disabled{background:var(--ext-n300);border-color:var(--ext-n300);cursor:not-allowed;}' +
    /* Dark mode */
    'html.ext-night #ext-pat-modal{background:#262a31 !important;}' +
    'html.ext-night #ext-pat-modal .pat-header{background:#172236 !important;color:#7aa9ff !important;}' +
    'html.ext-night #ext-pat-modal .pat-city-name{color:#e8eaed !important;}' +
    'html.ext-night #ext-pat-modal input[type=number],' +
    'html.ext-night #ext-pat-modal select,' +
    'html.ext-night #ext-pat-modal .pat-stepper-input{' +
      'background:#1e2126 !important;color:#e8eaed !important;border-color:#3a4250 !important;' +
    '}' +
    'html.ext-night #ext-pat-modal .pat-stepper-btn{background:#1e2126 !important;border-color:#3a4250 !important;color:#b0bcca !important;}' +
    'html.ext-night #ext-pat-modal .pat-stepper-val{color:#e8eaed !important;}' +
    'html.ext-night #ext-pat-modal .pat-static-val{color:#e8eaed !important;}' +
    'html.ext-night #ext-pat-modal .pat-summary{background:#1e2126 !important;border-color:#3a4250 !important;color:#a8b0b9 !important;}' +
    'html.ext-night #ext-pat-modal .pat-footer{background:#1e2126 !important;border-color:rgba(255,255,255,.09) !important;}' +
    'html.ext-night #ext-pat-modal .pat-btn-cancel{background:#1e2126 !important;border-color:#3a4250 !important;color:#b0bcca !important;}';
  document.head.appendChild(style);
}

// --- Time helpers ---

function formatTimeInTz(date, tzOffset, tzName) {
  var d  = new Date(date.getTime() + tzOffset * 3600000);
  var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dd = String(d.getUTCDate()).padStart(2, '0');
  var hh = String(d.getUTCHours()).padStart(2, '0');
  var mi = String(d.getUTCMinutes()).padStart(2, '0');
  return mm + '/' + dd + ' ' + hh + ':' + mi + (tzName ? ' ' + tzName : ' UTC');
}

function toDatetimeLocalInTz(date, tzOffset) {
  var d  = new Date(date.getTime() + tzOffset * 3600000);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0') + 'T' +
    String(d.getUTCHours()).padStart(2, '0') + ':' +
    String(d.getUTCMinutes()).padStart(2, '0');
}

function fromDatetimeLocalInTz(inputVal, tzOffset) {
  // inputVal = "YYYY-MM-DDTHH:mm" treated as TZ-local → convert to UTC
  var utcGuess = new Date(inputVal + ':00Z');
  return new Date(utcGuess.getTime() - tzOffset * 3600000);
}

// Build a ±15-min stepper control.
// timeResult = { date: Date(UTC), tzName, tzOffset } OR null — null means the load's real
// time could not be read (missing/unparseable arrival, or a tzError already nulled it out
// upstream). No fake time is fabricated for a null input (no-silent-fallback rule, same as
// Payout, 2026-07-20): the stepper starts empty, minus/plus are disabled until a value
// exists, and the manual-entry input is shown immediately instead of hidden behind a click.
// onChange (optional) fires whenever cur transitions between having a value and not (or the
// value itself changes) — used by openPostModal to keep Confirm's gating live.
// testidBase = e.g. "ext-pat-start"
// Returns { el: HTMLElement, getDate: () => Date|null }
function makeTimeStepper(timeResult, testidBase, onChange) {
  logger.log('patModal', 'makeTimeStepper called', { testidBase: testidBase, missing: !timeResult });
  var cur    = timeResult ? timeResult.date     : null;
  var tzName = timeResult ? timeResult.tzName   : 'UTC';
  var tzOff  = timeResult ? timeResult.tzOffset  : 0;

  var wrap = document.createElement('div');
  wrap.className = 'pat-stepper';

  var row = document.createElement('div');
  row.className = 'pat-stepper-row';

  var minusBtn = document.createElement('button');
  minusBtn.setAttribute('type', 'button');
  minusBtn.setAttribute('data-testid', testidBase + '-minus');
  minusBtn.className = 'pat-stepper-btn';
  minusBtn.textContent = '−';

  var valSpan = document.createElement('span');
  valSpan.setAttribute('data-testid', testidBase);
  valSpan.className = 'pat-stepper-val';
  valSpan.setAttribute('role', 'button');
  valSpan.setAttribute('tabindex', '0');
  valSpan.setAttribute('title', 'Click to edit');

  var plusBtn = document.createElement('button');
  plusBtn.setAttribute('type', 'button');
  plusBtn.setAttribute('data-testid', testidBase + '-plus');
  plusBtn.className = 'pat-stepper-btn';
  plusBtn.textContent = '+';

  var dtInput = document.createElement('input');
  dtInput.setAttribute('type', 'datetime-local');
  dtInput.setAttribute('data-testid', testidBase + '-input');
  dtInput.className = 'pat-stepper-input';

  function updateDisplay() {
    if (cur) {
      valSpan.textContent = formatTimeInTz(cur, tzOff, tzName);
      dtInput.value       = toDatetimeLocalInTz(cur, tzOff);
    } else {
      valSpan.textContent = 'Not set — click to enter';
      dtInput.value       = '';
    }
    minusBtn.disabled = !cur;
    plusBtn.disabled  = !cur;
  }

  // Missing time: show the manual-entry input right away — there is nothing to display
  // behind a click yet. Present time: keep the original collapsed-by-default behavior.
  dtInput.style.display = cur ? 'none' : '';
  updateDisplay();

  minusBtn.addEventListener('click', function () {
    if (!cur) return;
    cur = new Date(cur.getTime() - 15 * 60000);
    updateDisplay();
    if (onChange) onChange();
  });
  plusBtn.addEventListener('click', function () {
    if (!cur) return;
    cur = new Date(cur.getTime() + 15 * 60000);
    updateDisplay();
    if (onChange) onChange();
  });

  valSpan.addEventListener('click', function () {
    var hidden = dtInput.style.display === 'none';
    dtInput.style.display = hidden ? '' : 'none';
    if (hidden) dtInput.focus();
  });
  valSpan.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      dtInput.style.display = dtInput.style.display === 'none' ? '' : 'none';
      if (dtInput.style.display !== 'none') dtInput.focus();
    }
  });

  dtInput.addEventListener('change', function () {
    var hadValue = !!cur;
    if (dtInput.value) {
      var parsed = fromDatetimeLocalInTz(dtInput.value, tzOff);
      if (!isNaN(parsed.getTime())) { cur = parsed; updateDisplay(); }
    }
    // Once a value exists, collapse back to the click-to-edit display, same as before.
    // While still missing (dispatcher closed the picker without entering anything valid),
    // keep it open — there is nothing else to show.
    if (cur) dtInput.style.display = 'none';
    if (onChange && !!cur !== hadValue) onChange();
  });
  dtInput.addEventListener('blur', function () {
    setTimeout(function () { if (cur) dtInput.style.display = 'none'; }, 200);
  });

  row.appendChild(minusBtn);
  row.appendChild(valSpan);
  row.appendChild(plusBtn);
  wrap.appendChild(row);
  wrap.appendChild(dtInput);

  return { el: wrap, getDate: function () { return cur; } };
}

// Render a simple one-message modal (unsupported equipment / missing detail).
// Uses PAT_MODAL_ID so removePatModal() cleans it up.
function showSimplePatModal(message, testidKey) {
  logger.log('patModal', 'showSimplePatModal called', { testidKey: testidKey });
  injectPatModalStyle();
  removePatModal();

  var overlay = document.createElement('div');
  overlay.id = PAT_MODAL_ID;
  overlay.setAttribute('data-testid', 'pat-modal-overlay');
  overlay.addEventListener('click', function (ev) {
    if (ev.target === overlay) removePatModal();
  });

  var modal = document.createElement('div');
  modal.id = 'ext-pat-modal';
  modal.setAttribute('data-testid', 'pat-modal');

  var header = document.createElement('div');
  header.className = 'pat-header';
  var titleEl = document.createElement('span');
  titleEl.textContent = 'Create Truck Post';
  var closeBtn = document.createElement('button');
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('data-testid', 'pat-modal-close');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.className = 'pat-header-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', removePatModal);
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  var body = document.createElement('div');
  body.className = 'pat-body';
  var msgEl = document.createElement('p');
  msgEl.setAttribute('data-testid', testidKey || 'pat-simple-msg');
  msgEl.style.cssText = 'margin:0;line-height:1.5;color:var(--ext-n900);';
  msgEl.textContent = message;
  body.appendChild(msgEl);

  var footer = document.createElement('div');
  footer.className = 'pat-footer';
  var closeFooter = document.createElement('button');
  closeFooter.setAttribute('type', 'button');
  closeFooter.setAttribute('data-testid', 'pat-cancel');
  closeFooter.className = 'pat-btn pat-btn-cancel';
  closeFooter.textContent = 'Close';
  closeFooter.addEventListener('click', removePatModal);
  footer.appendChild(closeFooter);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function onKey(ev) {
    if (ev.key === 'Escape') { removePatModal(); document.removeEventListener('keydown', onKey); }
  }
  document.addEventListener('keydown', onKey);
  // LEAK FIX 2026-08-28 — the handle goes ON THE ELEMENT so removePatModal() can reach it.
  // Same pattern as the sidebar's drag listeners (content.js:795-797 reads _extDragMove /
  // _extDragUp off the element it is about to remove); reused rather than reinvented.
  overlay._extPatKeydown = onKey;
}

// 🔑 THE SINGLE TEARDOWN POINT FOR THE PAT MODAL. Every close path goes through here — the
// backdrop (:331, :1094), the header × and footer Close, Confirm's delayed close (:1635),
// Escape, and a second modal REPLACING the first (:325, :1088). Nothing outside this file
// removes the overlay, so cleaning up here covers all of them BY CONSTRUCTION rather than by
// each call site remembering to.
//
// ⚠ LEAK FIX 2026-08-28 (leak inventory). The keydown listener used to be removed ONLY inside
// its own Escape branch, so every modal closed any OTHER way left one listener on the document
// for the life of the page — each closing over its own modal's scope, which kept the whole
// modal alive too. It was the only listener in the extension that accumulated with ordinary
// dispatcher use.
function removePatModal() {
  logger.log('patModal', 'removePatModal called');
  var el = document.getElementById(PAT_MODAL_ID);
  if (!el) return;

  // Read the handle BEFORE detaching the node, so the order of these two lines can never matter.
  //
  // ⚠ The Escape branch ALSO removes this listener, so on that path removeEventListener runs
  // twice with the same arguments. That is deliberately left alone and is harmless: removing a
  // listener that is not registered is a defined no-op in the DOM spec, not an error. The Escape
  // branch is untouched so this change cannot alter WHEN or HOW the modal closes.
  if (el._extPatKeydown) {
    document.removeEventListener('keydown', el._extPatKeydown);
    el._extPatKeydown = null;
  }
  el.remove();
}

// Helper: make a select element with given options array [[value, label], ...]
function makeSelect(testid, options, defaultVal) {
  var sel = document.createElement('select');
  sel.setAttribute('data-testid', testid);
  options.forEach(function (opt) {
    var o = document.createElement('option');
    o.value = opt[0];
    o.textContent = opt[1];
    if (String(opt[0]) === String(defaultVal)) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

// ── PAT SOURCE: THE CAPTURED RECORD, AND NOTHING ELSE (2026-08-19) ────────────────────────
//
// ARCHITECTURAL DIRECTIVE (Ihor). One work opportunity = one id + one block of data returned by
// Amazon's API. PAT builds a post from THAT BLOCK ALONE. It does not read the card DOM, Amazon's
// detail sheet, or any other page element for any field value. These loads will later be served
// from Ihor's own site through his own server, where no Amazon DOM exists — any DOM dependency
// left here is a dependency that breaks there.
//
// THIS REPLACED A REGRESSION. PLAN 29a removed the detail-sheet scrape; PAT still read
// detail.header.stopsCount (a path that no longer exists) and re-parsed rendered time strings
// with a M/D regex that cannot match what Stage B emits. Both failure modes are gone because
// nothing is re-parsed from a rendered string any more — the ISO instant is consumed directly.
//
// The record shape is projectRecord() in networkObserver.js. Field paths used here, all measured
// present across 154 captured work opportunities: stopCount, payout, totalDistance,
// loads[].equipmentType, loads[].stops[].{city,state,tz,checkIn,checkOut,unloadingType}.

// D1/D2 (Ihor, 2026-08-19). A post is NOT a copy of the load: it sits as close to the real load
// as possible while carrying a tolerance window, the same way the payout carries its margin.
var PAT_START_LEAD_MINUTES = 30;   // start = first CHECKIN  − 30 min
var PAT_END_TRAIL_HOURS    = 3;    // end   = last  CHECKOUT + 3 h

// EQUIPMENT: enum -> PAT constant, DIRECTLY. Never via the display label — PAT_EQUIPMENT_MAP is
// keyed "53' Container and Chassis" while the panel's label for the same enum is "53' Container",
// so a display round-trip would push a SUPPORTED load into the unsupported-equipment modal.
//
// ⚠ ONLY these two enum values have ever been observed in a capture. FORTY_FOOT_CONTAINER and
// TWENTY_SIX_FOOT_BOX_TRUCK exist in patApi.js but appear in no sample, so no mapping is invented
// for them: an unlisted enum is logged verbatim and routed to the existing unsupported path.
var PAT_EQUIPMENT_BY_ENUM = {
  FIFTY_THREE_FOOT_TRUCK:     PAT_EQUIPMENT_TYPES_53,
  FIFTY_THREE_FOOT_CONTAINER: PAT_EQUIPMENT_TYPES_CONTAINER,
  // L3, added 2026-08-19: TWENTY_SIX_FOOT_BOX_TRUCK is confirmed against a real captured upsert
  // (equipmentTypes: ["TWENTY_SIX_FOOT_BOX_TRUCK"]). The record side uses the same token as the
  // upsert array's first element — the pattern the 53' cases already demonstrate, where the
  // record's FIFTY_THREE_FOOT_TRUCK is PAT_EQUIPMENT_TYPES_53[0].
  TWENTY_SIX_FOOT_BOX_TRUCK:  PAT_EQUIPMENT_TYPES_26_TRUCK,
  // ⚠ FORTY_FOOT_CONTAINER STAYS UNMAPPED. It is in patApi.js but appears in NO captured upsert
  // and no board record, so it keeps the "ask for a capture" path: logged verbatim, routed to the
  // unsupported-equipment modal.
};

// F1 (2026-08-19). DISPLAY ONLY — the modal summary line. Keyed on the same two enums as the map
// above, using PAT's own supported-equipment vocabulary, so the summary says what PAT means. It
// feeds NO posted value; the payload comes from PAT_EQUIPMENT_BY_ENUM. Unreachable for an unmapped
// enum, because the equipment gate returns before the summary is built.
var PAT_EQUIPMENT_LABEL_BY_ENUM = {
  FIFTY_THREE_FOOT_TRUCK:     "53' Trailer",
  FIFTY_THREE_FOOT_CONTAINER: "53' Container and Chassis",
  TWENTY_SIX_FOOT_BOX_TRUCK:  "26' Truck",
};

// ── F3: THE POSTED LOADING TYPE IS FIXED (Ihor's product decision, 2026-08-19) ────────────
//
// ALWAYS "Live or Drop & Hook", for EVERY load, unconditionally. It is NOT a mapping, NOT derived
// from the record, NOT derived from the card. The board's own label no longer influences it.
//
// WHY, so nobody "fixes" this back to being load-dependent: the wider option accepts BOTH Live and
// Drop, which is the same tolerance logic already applied to time (-30 min / +3 h) and payout
// (x1.10). A post is not a copy of the load.
//
// CONSEQUENCES IHOR HAS EXPLICITLY ACCEPTED:
//   - a load the board labels "Drop" now posts as "Live or Drop & Hook";
//   - a load labelled "LTL/Live/Drop", which PAT previously REFUSED to post
//     (resolveLoadingType returned null -> blocking error), now posts.
//
// ⚠ PROVENANCE OF THESE TWO VALUES, stated plainly because one of them is not on disk:
//   - the LABEL "Live or Drop & Hook" is Amazon's own UI wording. It appears in NO capture in
//     samples/ and in no doc; it is used here purely as summary text.
//   - the PAYLOAD ["LIVE","DROP"] is this codebase's existing representation of "accepts both",
//     inherited from resolveLoadingType('Live/Drop'). The captured upserts in api-samples.md show
//     only ["LIVE"] and ["DROP"] — the PAIR has never been captured. If Amazon rejects a post or
//     silently narrows the option, THIS is the first thing to check, and a capture of a manual
//     "Live or Drop & Hook" post would settle it.
// ⚠ CORRECTED 2026-08-19 FROM A REAL CAPTURE. This was ['LIVE', 'DROP'] — a shape that has NEVER
// been observed in any captured upsert. It came from an inference that "accepts both" must mean
// both tokens, and that inference was flagged at the time as the one unverified value in a live
// post. The capture settled it:
//     form "Live or Drop & Hook"  ->  loadingTypeList: ["LIVE"]
//     form "Drop & Hook"          ->  loadingTypeList: ["DROP"]
// In THIS API ["LIVE"] IS the wider option. See samples/pat-upsert-loading-type-control.json.
// Ihor's product rule is unchanged: always the wider option, for every load, never derived.
var PAT_LOADING_TYPE_LIST  = ['LIVE'];
var PAT_LOADING_TYPE_LABEL = 'Live or Drop & Hook';


// ── TRAILER OWNERSHIP — ⚠ INTERIM DOM DEPENDENCY (2026-08-20) ─────────────────────────────
//
// ⚠⚠ THIS IS THE ONLY FIELD IN THE PAYLOAD NOT SOURCED FROM THE API RECORD, AND IT BREAKS THE
// STANDING DIRECTIVE that one id plus one API record is the only source. Ihor authorised it as a
// deliberate, temporary exception. DELETE IT when either of these happens:
//   1. the record-based rule is found (the label collection in cityAssign.js exists to find it), or
//   2. Ihor's own backend supplies trailer ownership directly.
// Do NOT extend this pattern to any other field. Everything else stays record-sourced.
//
// WHY IT EXISTS. The P/R marker cannot be read from the captured /search bodies, and that is
// structural, not a gap in effort: the marker sits on the equipment FILTER option, request bodies
// are never captured, and BOTH variants collapse onto the same loads[].equipmentType. Four
// hypotheses were tested and refuted — assetOwner, containerOwner, C1 ("any stop LIVE means R")
// and C5 ("any DROP means P"). See api-samples.md 11 and BACKLOG 0p.
//
// WHAT IT READS. The letter Amazon itself renders in div.trailer-type-circle > p, which
// loadParser.js:84 already parses into trailerLetter. No new DOM traversal is introduced here —
// this reads an in-memory map that loadParser fills.
//
// ⚠ "R" HAS NEVER BEEN OBSERVED IN A CAPTURED CARD — only "P". The R branch is UNVERIFIED until
// Ihor tests it on a real R load. The modal diagnostics say so out loud.
//
// providedTrailerType and visibleProvidedTrailerType always carry the SAME value — confirmed
// across all eleven captured upserts (api-samples.md 8a).
var PAT_TRAILER_BY_LETTER = {
  P: PAT_TRAILER_AMAZON_PROVIDED,   // Provided — Amazon supplies the trailer
  R: PAT_TRAILER_CARRIER_OWNED,     // Required — the carrier must supply it
};
var PAT_TRAILER_LABEL_BY_LETTER = { P: 'Provided', R: 'Required' };

// The badge letter for a load. Prefers cityAssign's label map, which shares the record's id,
// eviction and teardown; falls back to loadStore for the case where cityAssign has not loaded.
// Both hold the SAME value from the SAME parse — loadParser writes to each.
function patTrailerLetter(loadId) {
  logger.log('patModal', 'patTrailerLetter called', { loadId: !!loadId });
  try {
    if (typeof getTrailerLabel === 'function') {
      var viaLabel = getTrailerLabel(loadId);
      if (viaLabel) return String(viaLabel);
    }
    if (typeof loadStore !== 'undefined' && loadStore.getLoadUnit) {
      var unit = loadStore.getLoadUnit(loadId);
      if (unit && unit.trailerLetter) return String(unit.trailerLetter);
    }
    return null;
  } catch (e) {
    logger.error('patModal', 'patTrailerLetter failed — treating the trailer type as unresolved',
      { error: e, loadId: !!loadId });
    return null;
  }
}

// ── DRIVER TYPE, DERIVED FROM THE LOAD (2026-08-19) ───────────────────────────────────────
//
// IHOR'S PRODUCT RULE: the driver type is a property of the LOAD, not a choice. A solo load is
// for a solo driver and a team load is for a team — a solo driver CANNOT run a team load. The
// mapping is strictly one to one, with no default, no fallback and no dispatcher override.
// There is deliberately NO control, toggle or "change it here" affordance.
//
// MEASURED. transitOperatorType across every capture on disk: "SINGLE_DRIVER" x159, field absent
// 0 — one value only. "TEAM_DRIVER" is known from Ihor's live PATDIAG DRIVER line on load
// d075a306, not from disk.
//
// EACH ENTRY CARRIES TWO SEPARATE THINGS, and they are not the same fact:
//   label - what the modal SHOWS. Known for both values.
//   types - what gets POSTED. Known only for solo.
//
// BOTH VALUES ARE NOW CAPTURE-BACKED (2026-08-19). TEAM_DRIVER was blocked from posting until a
// real upsert containing driverTypes: ["TEAM"] existed; Ihor captured one, so the types slot is
// filled and a team load posts correctly. An unlisted or missing transitOperatorType still gets
// NO mapping and NO default — Confirm stays disabled with the raw value named.
var PAT_DRIVER_BY_TRANSIT_OPERATOR = {
  SINGLE_DRIVER: { label: 'Solo', types: PAT_DRIVER_TYPES_SOLO },
  TEAM_DRIVER:   { label: 'Team', types: PAT_DRIVER_TYPES_TEAM },
};

// ── STATE CODE NORMALISATION (2026-08-19) ─────────────────────────────────────────────────
//
// THE DEFECT THIS FIXES. resolvePATCity() matches Amazon's cities API on its two-letter
// stateCode: "results[i].stateCode === state". The record's stops[].location.state carries BOTH
// forms in the SAME field. Measured across 506 captured stops:
//     two-letter CODE : 454 / 506   (IL, OH, IN, KY, TN, TX, AR, NC, VA, FL, PA, NJ, OK, MI,
//                                    DE, NE, WI, IA, SC, MO, MD, GA, KS, MS)
//     full state NAME :  52 / 506   (Ohio, Florida, Indiana, Missouri, Maryland, KENTUCKY,
//                                    Pennsylvania, TEXAS, Kentucky, Virginia, West Virginia,
//                                    New York)
// Every full-name stop failed on every match path, which is exactly Ihor's «MONROE, Ohio».
//
// WHY A TABLE AND NOT A FIELD. There is no field that reliably holds the code: "state" is the
// only state field on "location", and both forms appear in it. "country" is always two letters
// but is the COUNTRY. Measured over every key on all 506 stop locations — nothing else carries
// the state. So option (a) from the brief is not available and this is option (b).
//
// ⚠ EXHAUSTIVE AND EXACT, BY REQUIREMENT. No fuzzy matching, no prefix matching, and above all no
// "first two letters" — that heuristic is actively wrong here: "New York" would become NE, which
// is NEBRASKA, and "West Virginia" would become WE, which is nothing. An unrecognised value
// returns null and the city then fails to resolve exactly as it does today, leaving Confirm
// disabled with the value named on screen. Nothing is ever guessed.
//
// Casing varies in the captures ("KENTUCKY" and "Kentucky" both occur), so lookup is
// case-insensitive. Keys are lower case; a value already two letters is accepted as a code —
// safe because no US state or Canadian province has a two-letter name.
//
// NOT INCLUDED: US overseas territories (PR, VI, GU, AS, MP). None appears in any capture, and an
// entry nobody has seen Amazon send is a guess. If one ever appears it fails loudly and the log
// names it, which is the signal to add it.
var PAT_STATE_CODE_BY_NAME = {
  // United States — 50 states plus the District of Columbia
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI',
  'wyoming': 'WY', 'district of columbia': 'DC',
  // Canada — 10 provinces and 3 territories
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', 'northwest territories': 'NT', 'nova scotia': 'NS',
  'nunavut': 'NU', 'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
  'quebec (quebec)': 'QC', 'saskatchewan': 'SK', 'yukon': 'YT',
};

// Returns the two-letter code, or null when the value is not recognised. Null is a real answer —
// the caller keeps the raw value so the on-screen failure names it.
function patStateCode(raw) {
  logger.log('patModal', 'patStateCode called', { hasValue: !!raw });
  try {
    var v = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!v) return null;
    if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
    var hit = PAT_STATE_CODE_BY_NAME[v.toLowerCase()];
    return hit || null;
  } catch (e) {
    logger.error('patModal', 'patStateCode failed — treating the state as unrecognised', {
      error: e, rawState: raw
    });
    return null;
  }
}

// { city, state } for a stop, with the state normalised to a code. On an unrecognised state the
// RAW value is kept so resolvePATCity fails and the existing message names it — the failure path
// is deliberately unchanged.
function patStopPlace(stop, which, loadId) {
  logger.log('patModal', 'patStopPlace called', { which: which });
  try {
    if (!stop || !stop.city) return null;
    var code = patStateCode(stop.state);
    if (code === null) {
      // The raw STATE is logged deliberately: without it nobody can extend the table. The city
      // is not, per this file's PII convention.
      logger.error('patModal', 'patStateCode: UNRECOGNISED state value — not guessing. The city ' +
        'will fail to resolve and Confirm will stay disabled. Add this value to ' +
        'PAT_STATE_CODE_BY_NAME once confirmed.', {
        loadId: loadId, which: which, rawState: stop.state
      });
      return { city: stop.city, state: String(stop.state || '') };
    }
    return { city: stop.city, state: code };
  } catch (e) {
    logger.error('patModal', 'patStopPlace failed', { error: e, which: which, loadId: loadId });
    return null;
  }
}

// The UTC offset and short zone name in force at a given instant, from the stop's own IANA zone.
// D4: this replaces the old fixed TZ_OFFSET_HOURS table and the year guessing in
// parsePatStopTime() — the record carries a real instant, so nothing has to be inferred.
// Because the offset is resolved AT THAT INSTANT, a load either side of a DST change gets the
// offset that actually applies to it, which the fixed table could not do.
function patZoneAt(date, zone) {
  logger.log('patModal', 'patZoneAt called', { zone: zone });
  try {
    if (!zone) return null;
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var p = {};
    dtf.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    // hour12:false yields '24' for midnight in some engines; normalise before arithmetic.
    var hour = parseInt(p.hour, 10) % 24;
    var asIfUtc = Date.UTC(parseInt(p.year, 10), parseInt(p.month, 10) - 1, parseInt(p.day, 10),
                           hour, parseInt(p.minute, 10), parseInt(p.second, 10));
    var offset = (asIfUtc - date.getTime()) / 3600000;

    var name = '';
    try {
      var nf = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
      nf.formatToParts(date).forEach(function (x) { if (x.type === 'timeZoneName') name = x.value; });
    } catch (e1) {
      logger.error('patModal', 'patZoneAt: short zone name unavailable — using the offset alone',
        { error: e1, zone: zone });
    }
    return { offset: offset, name: name };
  } catch (e) {
    logger.error('patModal', 'patZoneAt failed — time will be reported as unresolvable', {
      error: e, zone: zone
    });
    return null;
  }
}

// An ISO instant + IANA zone + a shift, in the { date, tzName, tzOffset } shape the modal's
// stepper and formatters already consume. Returns null when anything is missing — never a
// fabricated time (no-silent-fallback rule).
function patTimeFrom(iso, zone, shiftMs) {
  logger.log('patModal', 'patTimeFrom called', { hasIso: !!iso, zone: zone, shiftMs: shiftMs });
  try {
    if (!iso) return null;
    var base = new Date(iso);
    if (isNaN(base.getTime())) {
      logger.error('patModal', 'patTimeFrom: unparseable ISO instant from the record', { iso: iso });
      return null;
    }
    var shifted = new Date(base.getTime() + (shiftMs || 0));
    var z = patZoneAt(shifted, zone);
    if (!z) return null;
    return { date: shifted, tzName: z.name, tzOffset: z.offset };
  } catch (e) {
    logger.error('patModal', 'patTimeFrom failed', { error: e, iso: iso, zone: zone });
    return null;
  }
}

// Everything PAT needs, derived from the record alone. Pure: no DOM, no network, no state.
// "missing" names every required field that could not be resolved, so Confirm can stay disabled
// and the dispatcher is told WHICH field is missing rather than being shown a guessed value.
function patSourceFromRecord(record) {
  logger.log('patModal', 'patSourceFromRecord called', { loadId: record && record.id });
  var out = {
    loadId: record && record.id, equipmentEnum: null, equipmentTypes: null,
    transitOperatorType: null,
    driverLabel: null, driverTypes: null,
    payout: null, distance: null, stopCount: null,
    origin: null, dest: null, startTime: null, endTime: null,
    loadingTypeList: null, unloadingEnum: null, missing: []
  };
  try {
    if (!record) { out.missing.push('record'); return out; }
    var loads = record.loads || [];
    var firstLoad = loads[0] || null;
    var lastLoad  = loads.length ? loads[loads.length - 1] : null;
    var firstStop = (firstLoad && firstLoad.stops && firstLoad.stops[0]) || null;
    var lastStop  = (lastLoad && lastLoad.stops && lastLoad.stops.length)
      ? lastLoad.stops[lastLoad.stops.length - 1] : null;

    out.transitOperatorType = (typeof record.transitOperatorType === 'string')
      ? record.transitOperatorType : null;
    // Strictly one to one. An unlisted or missing value gets NO mapping and NO default.
    var driver = (out.transitOperatorType &&
        Object.prototype.hasOwnProperty.call(PAT_DRIVER_BY_TRANSIT_OPERATOR, out.transitOperatorType))
      ? PAT_DRIVER_BY_TRANSIT_OPERATOR[out.transitOperatorType] : null;
    out.driverLabel = driver ? driver.label : null;
    out.driverTypes = driver ? driver.types : null;

    // Equipment — the load's, not the stop's.
    out.equipmentEnum = (firstLoad && firstLoad.equipmentType) || null;
    if (out.equipmentEnum &&
        Object.prototype.hasOwnProperty.call(PAT_EQUIPMENT_BY_ENUM, out.equipmentEnum)) {
      out.equipmentTypes = PAT_EQUIPMENT_BY_ENUM[out.equipmentEnum];
    }

    // Money and distance — from the record, per the directive. The x1.10 markup is applied by
    // the caller and is NOT changed here; only the base value's source moved.
    out.payout   = (typeof record.payout === 'number') ? record.payout : null;
    out.distance = (typeof record.totalDistance === 'number') ? record.totalDistance : null;

    // D3: stop count is the record's own, which is the number the card shows.
    out.stopCount = (typeof record.stopCount === 'number' && record.stopCount >= 1)
      ? record.stopCount : null;

    // Cities come as discrete fields — nothing is parsed out of an address string. The state is
    // normalised to the two-letter code resolvePATCity matches on; see PAT_STATE_CODE_BY_NAME.
    out.origin = patStopPlace(firstStop, 'origin', out.loadId);
    out.dest   = patStopPlace(lastStop, 'destination', out.loadId);

    // D1 / D2 / D4.
    out.startTime = firstStop
      ? patTimeFrom(firstStop.checkIn, firstStop.tz, -PAT_START_LEAD_MINUTES * 60000) : null;
    out.endTime = lastStop
      ? patTimeFrom(lastStop.checkOut, lastStop.tz, PAT_END_TRAIL_HOURS * 3600000) : null;

    // F3 (2026-08-19): THE RECORD NO LONGER DECIDES THE LOADING TYPE. The posted value is the
    // fixed PAT_LOADING_TYPE_LIST for every load — see the constant for the reasoning. The stop's
    // own enum is still READ, but only so PATDIAG SOURCE can show what the load actually says
    // beside what we post. It influences nothing.
    out.unloadingEnum = (lastStop && lastStop.unloadingType) || null;
    out.loadingTypeList = PAT_LOADING_TYPE_LIST;

    // Unpostable for either reason: an unknown operator type, or a known one (TEAM_DRIVER) whose
    // upsert enum has never been captured. Both must block — never post a guessed driver type.
    if (!out.driverTypes)      out.missing.push('driver type');
    if (!out.equipmentTypes)   out.missing.push('equipment');
    if (out.payout === null)   out.missing.push('payout');
    if (out.distance === null) out.missing.push('distance');
    if (out.stopCount === null) out.missing.push('stopCount');
    if (!out.origin)           out.missing.push('origin city');
    if (!out.dest)             out.missing.push('destination city');
    if (!out.startTime)        out.missing.push('start time');
    if (!out.endTime)          out.missing.push('end time');
    // Loading type is never "missing" any more — it is a constant (F3).
    return out;
  } catch (e) {
    logger.error('patModal', 'patSourceFromRecord failed — nothing is guessed, the modal will ' +
      'report the fields as missing', { error: e, loadId: record && record.id });
    out.missing.push('record (threw)');
    return out;
  }
}

// PATDIAG SOURCE — VERIFICATION AID ONLY (2026-08-19), behind CITY_ASSIGN_DEBUG.
//
// ⚠ THE CARD VALUES PRINTED HERE ARE NEVER USED. They are read solely so a disagreement between
// the API record and what the board shows is visible during Ihor's manual test — payout and
// distance above all. If this line ever became a fallback, the whole point of the directive would
// be lost.
// PATDIAG DRIVER — VERIFICATION AID ONLY (2026-08-19), behind CITY_ASSIGN_DEBUG.
//
// THE DEFECT IT MEASURES. The posted driver type is HARDCODED in two places and is read from
// nothing at all:
//   patApi.js  buildPatPayload()  driverTypes: ['SOLO']   <- a literal, NOT taken from formState
//   patModal.js                   driverVal.textContent = 'Solo'  <- a literal, in a static div
//                                                                    with no listener and no control
// A team load therefore posts as Solo. Unlike the city defect NOTHING BLOCKS IT: a wrong city
// stopped the post and was visible, a wrong driver type posts silently and wrongly.
//
// WHAT THE RECORD CARRIES. transitOperatorType is the ONLY field in the whole work opportunity
// whose name or value could distinguish team from solo — established by scanning every key path
// in all 159 captured records, and by finding no path anywhere whose value is ever TEAM or SOLO.
// It reads "SINGLE_DRIVER" in 159/159: every capture on disk is a solo load, so THE TEAM VALUE IS
// UNKNOWN. This line exists to learn it. Nothing is inferred from it and nothing posted depends
// on it.
function patDiagDriver(loadId, src) {
  logger.log('patModal', 'patDiagDriver called', { loadId: loadId });
  try {
    if (typeof CITY_ASSIGN_DEBUG === 'undefined' || !CITY_ASSIGN_DEBUG) return;
    var raw = src.transitOperatorType;
    var isKnownSolo = (raw === 'SINGLE_DRIVER');
    logger.log('patModal', 'PATDIAG DRIVER  ' + loadId +
      '  ||  record transitOperatorType = ' +
      (raw === null || raw === undefined ? 'NOT PRESENT IN THE RECORD' : JSON.stringify(raw)) +
      '  ||  PAT will post driverTypes = ["SOLO"]  (HARDCODED in patApi.js buildPatPayload — not ' +
      'read from the record, not from the card, not from any control)' +
      '  ||  the modal shows Driver = "Solo"  (HARDCODED, a static div)' +
      '  ||  AGREE: ' + (isKnownSolo
        ? 'yes — the record says SINGLE_DRIVER and we post SOLO'
        : '** NO — the record does NOT say SINGLE_DRIVER, so this load is very likely NOT solo ' +
          'and the post would be WRONG. Send this line to the PM verbatim. **'));
  } catch (e) {
    logger.error('patModal', 'patDiagDriver failed — diagnostics only', { error: e, loadId: loadId });
  }
}

function patDiagSource(loadId, src) {
  logger.log('patModal', 'patDiagSource called', { loadId: loadId });
  try {
    if (typeof CITY_ASSIGN_DEBUG === 'undefined' || !CITY_ASSIGN_DEBUG) return;
    var card = (typeof loadStore !== 'undefined' && loadStore.getLoadUnit)
      ? (loadStore.getLoadUnit(loadId) || {}) : {};
    var pair = function (label, rec, crd) {
      return label + ': record=' + (rec === null || rec === undefined ? '—' : rec) +
             ' card=' + (crd === null || crd === undefined || crd === '' ? '—' : crd);
    };
    var iso = function (t) { return t && t.date ? t.date.toISOString() : '—'; };
    logger.log('patModal', 'PATDIAG SOURCE  ' + loadId + '  ||  ' + [
      pair('equipment', src.equipmentEnum, card.equipment),
      pair('payout', src.payout, card.payout),
      pair('distance', src.distance, card.distance),
      pair('stopCount', src.stopCount, '(card has none — this is the field that was empty)'),
      pair('loadingType', src.unloadingEnum, card.loadingType),
      pair('origin', src.origin ? src.origin.city + ', ' + src.origin.state : null,
           (card.boardStops && card.boardStops[0]) || null),
      pair('dest', src.dest ? src.dest.city + ', ' + src.dest.state : null,
           (card.boardStops && card.boardStops.length) ? card.boardStops[card.boardStops.length - 1] : null)
    ].join('  |  ') +
      '  ||  start(CHECKIN−' + PAT_START_LEAD_MINUTES + 'min)=' + iso(src.startTime) +
      '  end(CHECKOUT+' + PAT_END_TRAIL_HOURS + 'h)=' + iso(src.endTime) +
      '  ||  missing: ' + (src.missing.length ? src.missing.join(', ') : 'none') +
      '  ||  ⚠ card values are DIAGNOSTIC ONLY and are never used');
  } catch (e) {
    logger.error('patModal', 'patDiagSource failed — diagnostics only, the modal is unaffected',
      { error: e, loadId: loadId });
  }
}

// F2 (2026-08-19). THE WHOLE BODY IS WRAPPED. openPostModal is async and its caller cannot see a
// synchronous throw, so before this wrapper a ReferenceError anywhere in ~600 lines of modal
// building became an unhandled promise rejection: no logger.error, no modal, nothing on screen,
// and smoke item (f) "no console errors" kept passing while (e) failed. That is exactly how
// «equipment is not defined» survived a live test.
//
// Two rules this enforces, and they are the point of the fix rather than the crash it caught:
//   1. NOTHING on this path fails silently — every escape is logged with context.
//   2. The dispatcher SEES the failure. A plain "could not be built" dialog beats a button that
//      does nothing, because a dead button reads as "no loads matched" rather than "broken".
async function openPostModal(loadId) {
  logger.log('patModal', 'openPostModal called', { loadId: loadId });
  try {
    return await openPostModalInner(loadId);
  } catch (e) {
    logger.error('patModal', 'openPostModal FAILED — the modal was not built', {
      error: e,
      message: e && e.message,
      stack: e && e.stack,
      loadId: loadId
    });
    // The dispatcher must not be left staring at a dead button. Its own failure is caught
    // separately so a broken DOM cannot turn a visible error back into a silent one.
    try {
      showSimplePatModal(
        'Post a Truck could not be opened for this load.\n' +
        'Nothing was sent. Please report this load to the PM — the console has the details.',
        'pat-open-failed'
      );
    } catch (e2) {
      logger.error('patModal', 'openPostModal: the failure dialog ALSO failed to render — the ' +
        'dispatcher has no on-screen signal, only this line', { error: e2, loadId: loadId });
    }
    return;
  }
}

async function openPostModalInner(loadId) {
  logger.log('patModal', 'openPostModalInner called', { loadId: loadId });

  if (!loadId) { logger.error('patModal', 'openPostModal: no loadId'); return; }

  // THE RECORD IS THE ONLY SOURCE. getLoadRecord() is cityAssign's store — the same one the
  // inline panel renders from. PAT is reachable only from the panel's action bar, and the panel
  // only renders when this call already returned a record, so it is present by construction;
  // the guard exists because "by construction" is not "checked".
  var record = (typeof getLoadRecord === 'function') ? getLoadRecord(loadId) : null;
  if (!record) {
    logger.warn('patModal', 'openPostModal: no captured record for this load', { loadId: loadId });
    showSimplePatModal('Load data not captured — reopen the load card.', 'pat-no-loadunit');
    return;
  }

  var src = patSourceFromRecord(record);
  patDiagSource(loadId, src);
  patDiagDriver(loadId, src);

  // --- Equipment gate ---
  // Enum -> PAT constant, never via a display label. An enum with no mapping is logged VERBATIM
  // at error level so Ihor knows exactly which capture to send, and is then handed to the
  // existing unsupported-equipment path unchanged (PLAN 8 — out of scope here).
  var patEquipmentTypes = src.equipmentTypes;
  if (!patEquipmentTypes) {
    if (!src.equipmentEnum) {
      logger.error('patModal', 'openPostModal: the record carries no equipmentType', { loadId: loadId });
      showSimplePatModal(
        "Could not read load data from this card — start the refresh loop once, or report this card layout to the PM.",
        'pat-no-equipment'
      );
    } else {
      logger.error('patModal', 'openPostModal: UNMAPPED equipment enum — no mapping is invented. ' +
        'Send the PM a capture of a board containing this equipment type.',
        { loadId: loadId, equipmentType: src.equipmentEnum });
      showSimplePatModal(
        "Post creation for this equipment type is not supported yet: «" + src.equipmentEnum + "».\n" +
        "To add it, capture a manual Post-a-Truck upsert for this type and send it to the PM.",
        'pat-unsupported-equipment'
      );
    }
    return;
  }

  // --- Cities: discrete fields from the record. Nothing is parsed out of an address string. ---
  var originParsed = src.origin || { city: '', state: '' };
  var destParsed   = src.dest   || { city: '', state: '' };
  var originInput  = originParsed;      // resolvePATCity accepts { city, state }
  var destInput    = destParsed;

  // --- Payout. Source moved to the record; the x1.10 markup is UNCHANGED. ---
  var payoutMissing = (src.payout === null) || !(src.payout > 0);
  if (payoutMissing) {
    logger.warn('patModal', 'openPostModal: record carries no usable payout — Payout left empty', {
      loadId: loadId, payout: src.payout
    });
  }
  var initPayout = payoutMissing ? null
    : parseFloat((src.payout * PAT_PAYOUT_MARKUP_RATE).toFixed(2));

  // --- Distance. Source moved to the record; the +/-25 window is UNCHANGED. ---
  var distanceMissing = (src.distance === null);
  var distMiles = distanceMissing ? 0 : src.distance;
  var minMiles  = distanceMissing ? null : Math.max(0, Math.round(distMiles) - 25);
  var maxMiles  = distanceMissing ? null : Math.round(distMiles) + 25;
  var initPermile = (!payoutMissing && distMiles > 0) ? (initPayout / distMiles).toFixed(2) : '';
  if (distanceMissing) {
    logger.warn('patModal', 'openPostModal: record carries no totalDistance — Min/Max Miles left empty', {
      loadId: loadId
    });
  }

  // --- D3: stop count, straight from the record. This is the field that was empty. ---
  var stopCount        = src.stopCount;
  var stopCountMissing = (stopCount === null);
  var stopsCountStr    = stopCountMissing ? '' : (stopCount + ' stops');
  if (stopCountMissing) {
    logger.warn('patModal', 'openPostModal: record carries no usable stopCount — field left empty', {
      loadId: loadId, stopCount: record.stopCount
    });
  }

  // --- F1: equipment DISPLAY text for the summary line, from the record like everything else.
  // Never from loadUnit and never from the card. No posted value depends on it. ---
  var equipment = PAT_EQUIPMENT_LABEL_BY_ENUM[src.equipmentEnum] || src.equipmentEnum || '';

  // --- Trailer ownership, from the badge letter. ⚠ INTERIM DOM DEPENDENCY — see the block above.
  // No default and no fallback: an unexpected or missing letter blocks the post. ---
  var trailerLetter = patTrailerLetter(loadId);
  var providedTrailerType = (trailerLetter &&
      Object.prototype.hasOwnProperty.call(PAT_TRAILER_BY_LETTER, trailerLetter))
    ? PAT_TRAILER_BY_LETTER[trailerLetter] : null;
  var trailerLabel = (trailerLetter &&
      Object.prototype.hasOwnProperty.call(PAT_TRAILER_LABEL_BY_LETTER, trailerLetter))
    ? PAT_TRAILER_LABEL_BY_LETTER[trailerLetter] : (trailerLetter || 'unknown');
  if (trailerLetter === 'R') {
    logger.warn('patModal', 'openPostModal: R (carrier-owned) trailer — this branch has NEVER ' +
      'been verified against a real post. "R" appears in no captured card. Check the posted ' +
      'trailer type on Amazon after confirming.', { loadId: loadId });
  }

  // --- Driver type, derived from the load. Read-only: no control, by product rule. ---
  var driverTypes = src.driverTypes;
  var driverLabel = src.driverLabel || (src.transitOperatorType || 'unknown');

  // --- F3: one fixed loading type for every load. Not derived. See PAT_LOADING_TYPE_LIST. ---
  var loadingTypeList = PAT_LOADING_TYPE_LIST;
  var loadingDispStr  = PAT_LOADING_TYPE_LABEL;
  if (src.unloadingEnum && src.unloadingEnum !== 'DROP') {
    logger.log('patModal', 'openPostModal: posting the fixed loading type; the load itself says ' +
      'something else — this is deliberate (F3), not a mismatch', {
      loadId: loadId, loadSays: src.unloadingEnum, posting: PAT_LOADING_TYPE_LABEL
    });
  }

  // --- D1 / D2 / D4: times, already shifted, from the real instant and the stop's IANA zone. ---
  var startTimeResult  = src.startTime;
  var endTimeResult    = src.endTime;
  var startTimeMissing = !startTimeResult;
  var endTimeMissing   = !endTimeResult;

  // F3: there is no "unknown loading type" blocking error any more — the value is a constant, so
  // it can never be unknown. The submit-time guard on loadingTypeList is left in place as a plain
  // defensive check on the payload; it does not choose anything.
  var blockingErrors = [];
  if (!providedTrailerType) {
    logger.error('patModal', 'openPostModal: trailer ownership UNRESOLVED — the card carried no ' +
      'recognised P/R badge letter. No default is applied; a guessed trailer type would post the ' +
      'wrong ownership to the live marketplace.', {
      loadId: loadId,
      trailerLetter: (trailerLetter === null || trailerLetter === undefined)
        ? '(no letter — the card was not parsed, or has no badge)' : trailerLetter
    });
    blockingErrors.push('Unknown trailer type: «' +
      ((trailerLetter === null || trailerLetter === undefined)
        ? 'no P/R badge read from this card' : String(trailerLetter)) +
      '» — cannot post without knowing whether Amazon provides the trailer.');
  }
  if (!driverTypes) {
    if (src.transitOperatorType === 'TEAM_DRIVER') {
      logger.error('patModal', 'openPostModal: TEAM load detected, but the upsert driverTypes ' +
        'value for a team post has never been captured — refusing to post rather than sending ' +
        'SOLO or a guessed enum. Capture a manual Post-a-Truck upsert with Team selected and ' +
        'send it to the PM.', { loadId: loadId, transitOperatorType: src.transitOperatorType });
      blockingErrors.push('This is a TEAM load. Posting it is blocked until the Team driver ' +
        'value is confirmed — a solo post would be wrong. Send the PM a Post-a-Truck capture ' +
        'made with Team selected.');
    } else {
      logger.error('patModal', 'openPostModal: UNMAPPED transitOperatorType — no mapping is ' +
        'invented and no default is applied. Send the PM a capture of this load.',
        { loadId: loadId, transitOperatorType: src.transitOperatorType });
      blockingErrors.push('Unknown driver type: «' +
        (src.transitOperatorType === null || src.transitOperatorType === undefined
          ? 'not present in the record' : String(src.transitOperatorType)) +
        '» — cannot post without knowing whether this load is solo or team.');
    }
  }
  if (startTimeMissing || endTimeMissing) {
    logger.warn('patModal', 'openPostModal: load time(s) missing from the record — left empty, no ' +
      'fabricated default', {
      loadId: loadId, startTimeMissing: startTimeMissing, endTimeMissing: endTimeMissing
    });
  }
  if (src.missing.length) {
    logger.warn('patModal', 'openPostModal: fields unresolved from the record — Confirm stays ' +
      'disabled until they are entered', { loadId: loadId, missing: src.missing.join(', ') });
  }

  // --- Build modal DOM ---
  injectPatModalStyle();
  removePatModal();

  var overlay = document.createElement('div');
  overlay.id = PAT_MODAL_ID;
  overlay.setAttribute('data-testid', 'pat-modal-overlay');
  overlay.addEventListener('click', function (ev) {
    if (ev.target === overlay) removePatModal();
  });

  var modal = document.createElement('div');
  modal.id = 'ext-pat-modal';
  modal.setAttribute('data-testid', 'pat-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'pat-modal-title');

  // Header
  var header = document.createElement('div');
  header.className = 'pat-header';
  var titleEl = document.createElement('span');
  titleEl.id = 'pat-modal-title';
  titleEl.setAttribute('data-testid', 'pat-modal-title');
  titleEl.textContent = 'Are you sure you want to create the following order?';
  var headerClose = document.createElement('button');
  headerClose.setAttribute('type', 'button');
  headerClose.setAttribute('data-testid', 'pat-modal-close');
  headerClose.setAttribute('aria-label', 'Close');
  headerClose.className = 'pat-header-close';
  headerClose.textContent = '×';
  headerClose.addEventListener('click', removePatModal);
  header.appendChild(titleEl);
  header.appendChild(headerClose);

  var body = document.createElement('div');
  body.className = 'pat-body';

  // --- Row 1: route (city names + radius selects) ---
  var routeRow = document.createElement('div');
  routeRow.className = 'pat-route-row';

  // Origin column
  var originCol = document.createElement('div');
  originCol.className = 'pat-route-col';
  var originColLabel = document.createElement('div');
  originColLabel.className = 'pat-col-label';
  originColLabel.textContent = 'Origin';
  var originNameEl = document.createElement('div');
  originNameEl.setAttribute('data-testid', 'ext-pat-origin');
  originNameEl.className = 'pat-city-name resolving';
  originNameEl.textContent = originParsed.city + (originParsed.state ? ', ' + originParsed.state : '');

  var originRadiusWrap = document.createElement('div');
  originRadiusWrap.className = 'pat-radius-wrap';
  var originRadiusSel = makeSelect('ext-pat-origin-radius',
    [[5,'5'],[10,'10'],[15,'15'],[20,'20'],[25,'25'],[50,'50'],[75,'75'],[100,'100']], 25);
  var originRadiusUnit = document.createElement('span');
  originRadiusUnit.className = 'pat-radius-unit';
  originRadiusUnit.textContent = 'mi';
  originRadiusWrap.appendChild(originRadiusSel);
  originRadiusWrap.appendChild(originRadiusUnit);

  originCol.appendChild(originColLabel);
  originCol.appendChild(originNameEl);
  originCol.appendChild(originRadiusWrap);

  // Arrow
  var routeArrow = document.createElement('div');
  routeArrow.className = 'pat-route-arrow';
  routeArrow.textContent = '→';

  // Destination column
  var destCol = document.createElement('div');
  destCol.className = 'pat-route-col';
  var destColLabel = document.createElement('div');
  destColLabel.className = 'pat-col-label';
  destColLabel.textContent = 'Destination';
  var destNameEl = document.createElement('div');
  destNameEl.setAttribute('data-testid', 'ext-pat-dest');
  destNameEl.className = 'pat-city-name resolving';
  destNameEl.textContent = destParsed.city + (destParsed.state ? ', ' + destParsed.state : '');

  var destRadiusWrap = document.createElement('div');
  destRadiusWrap.className = 'pat-radius-wrap';
  var destRadiusSel = makeSelect('ext-pat-dest-radius',
    [[25,'25'],[50,'50'],[75,'75'],[100,'100'],[150,'150'],[200,'200'],[250,'250']], 50);
  var destRadiusUnit = document.createElement('span');
  destRadiusUnit.className = 'pat-radius-unit';
  destRadiusUnit.textContent = 'mi';
  destRadiusWrap.appendChild(destRadiusSel);
  destRadiusWrap.appendChild(destRadiusUnit);

  destCol.appendChild(destColLabel);
  destCol.appendChild(destNameEl);
  destCol.appendChild(destRadiusWrap);

  routeRow.appendChild(originCol);
  routeRow.appendChild(routeArrow);
  routeRow.appendChild(destCol);

  // --- Row 2: time steppers ---
  var timesRow = document.createElement('div');
  timesRow.className = 'pat-times-row';

  // onChange: updateConfirmEnabled (defined below, in the footer section) is referenced
  // here via closure — safe despite the textual order since it's a hoisted function
  // declaration, and it's only ever invoked later, on user interaction.
  var startStepper = makeTimeStepper(startTimeResult, 'ext-pat-start', function () { updateConfirmEnabled(); });
  var endStepper   = makeTimeStepper(endTimeResult,   'ext-pat-end',   function () { updateConfirmEnabled(); });
  var timesArrow   = document.createElement('div');
  timesArrow.className = 'pat-route-arrow';
  timesArrow.textContent = '→';

  timesRow.appendChild(startStepper.el);
  timesRow.appendChild(timesArrow);
  timesRow.appendChild(endStepper.el);

  // Visible warning for the missing/unparseable-load-time edge case — same pattern as
  // ext-pat-payout-warning. Shown/hidden live by updateConfirmEnabled()/timesValid().
  var timesWarningEl = document.createElement('div');
  timesWarningEl.setAttribute('data-testid', 'ext-pat-times-warning');
  timesWarningEl.className = 'pat-times-warning';
  timesWarningEl.textContent = 'Load times could not be read — enter start/end time manually';

  // --- Row 3a: stops / min mi / max mi / driver ---
  var numsA = document.createElement('div');
  numsA.className = 'pat-nums-a';

  function numField(labelText, content) {
    var f = document.createElement('div');
    f.className = 'pat-num-field';
    var lbl = document.createElement('div');
    lbl.className = 'pat-num-label';
    lbl.textContent = labelText;
    f.appendChild(lbl);
    f.appendChild(content);
    return f;
  }

  // Stops (2026-07-30): a read-only display when the count parsed cleanly — unchanged from
  // before. When it did NOT parse, the same slot becomes a real number input instead, because
  // the old static div rendered the fabricated "0 Stops" and gave the dispatcher no way to
  // correct it. Both carry data-testid="ext-pat-stops", so that id always resolves to "the
  // stops field"; only its element type varies (div ⇄ input[type=number]).
  var stopsVal;
  var stopsInput = null; // non-null only in the unparseable case
  if (stopCountMissing) {
    stopsInput = document.createElement('input');
    stopsInput.setAttribute('type', 'number');
    stopsInput.setAttribute('data-testid', 'ext-pat-stops');
    stopsInput.setAttribute('min', '1');
    stopsInput.setAttribute('step', '1');
    stopsInput.value = '';
    stopsVal = stopsInput;
  } else {
    stopsVal = document.createElement('div');
    stopsVal.setAttribute('data-testid', 'ext-pat-stops');
    stopsVal.className = 'pat-static-val';
    stopsVal.textContent = stopsCountStr || (stopCount + ' Stops');
  }

  // Visible warning for the unreadable-stop-count edge case — same pattern and styling as
  // ext-pat-payout-warning / ext-pat-times-warning. Shown/hidden live by updateConfirmEnabled().
  var stopsWarningEl = document.createElement('div');
  stopsWarningEl.setAttribute('data-testid', 'ext-pat-stops-warning');
  stopsWarningEl.className = 'pat-stops-warning';
  stopsWarningEl.textContent = 'Stop count could not be read — enter it manually';

  // Min/Max Miles: left EMPTY when the board distance was unreadable (2026-07-30) rather
  // than prefilled with the derived-from-zero 0 and 25.
  var minMilesInput = document.createElement('input');
  minMilesInput.setAttribute('type', 'number');
  minMilesInput.setAttribute('data-testid', 'ext-pat-min-miles');
  minMilesInput.setAttribute('min', '0');
  minMilesInput.setAttribute('step', '1');
  minMilesInput.value = distanceMissing ? '' : String(minMiles);

  var maxMilesInput = document.createElement('input');
  maxMilesInput.setAttribute('type', 'number');
  maxMilesInput.setAttribute('data-testid', 'ext-pat-max-miles');
  maxMilesInput.setAttribute('min', '0');
  maxMilesInput.setAttribute('step', '1');
  maxMilesInput.value = distanceMissing ? '' : String(maxMiles);

  // Visible warning for the unreadable-distance edge case. Spans the Min/Max Miles pair, so
  // it is appended to the row rather than to one field.
  var distanceWarningEl = document.createElement('div');
  distanceWarningEl.setAttribute('data-testid', 'ext-pat-distance-warning');
  distanceWarningEl.className = 'pat-distance-warning';
  distanceWarningEl.textContent = 'Load distance could not be read — enter it manually';

  var driverVal = document.createElement('div');
  driverVal.setAttribute('data-testid', 'ext-pat-driver');
  driverVal.className = 'pat-static-val';
  // Derived from the load, never a literal and never editable (product rule: the driver type is
  // a property of the load, not a choice).
  driverVal.textContent = driverLabel;

  var stopsField = numField('Stops', stopsVal);
  stopsField.appendChild(stopsWarningEl);
  numsA.appendChild(stopsField);
  var minMilesField = numField('Min Miles', minMilesInput);
  minMilesField.appendChild(distanceWarningEl);
  numsA.appendChild(minMilesField);
  numsA.appendChild(numField('Max Miles', maxMilesInput));
  numsA.appendChild(numField('Driver', driverVal));

  // Re-gate Confirm whenever any of the three now-blocking numeric fields changes. Min/Max
  // Miles previously had NO listeners at all — nothing re-evaluated Confirm when they were
  // edited, which is part of why the fabricated 0/25 sailed through.
  minMilesInput.addEventListener('input', function () { updateConfirmEnabled(); });
  maxMilesInput.addEventListener('input', function () { updateConfirmEnabled(); });
  if (stopsInput) stopsInput.addEventListener('input', function () { updateConfirmEnabled(); });

  // --- Row 3b: per-mile / payout / stem ---
  var numsB = document.createElement('div');
  numsB.className = 'pat-nums-b';

  var permileInput = document.createElement('input');
  permileInput.setAttribute('type', 'number');
  permileInput.setAttribute('data-testid', 'ext-pat-permile');
  permileInput.setAttribute('min', '0');
  permileInput.setAttribute('step', '0.01');
  permileInput.value = initPermile;

  var payoutInput = document.createElement('input');
  payoutInput.setAttribute('type', 'number');
  payoutInput.setAttribute('data-testid', 'ext-pat-payout');
  payoutInput.setAttribute('min', '0');
  payoutInput.setAttribute('step', '1');
  payoutInput.value = payoutMissing ? '' : initPayout.toFixed(2);

  // Visible warning for the missing/unparseable-board-payout edge case. Shown/hidden and
  // wired into Confirm's enabled state by updateConfirmEnabled() (defined near the footer,
  // below) rather than statically here — it must re-hide live once the dispatcher types a
  // valid amount, not just at render time.
  var payoutWarningEl = document.createElement('div');
  payoutWarningEl.setAttribute('data-testid', 'ext-pat-payout-warning');
  payoutWarningEl.className = 'pat-payout-warning';
  payoutWarningEl.textContent = 'Board payout could not be read — enter payout manually';

  var payoutField = document.createElement('div');
  payoutField.className = 'pat-num-field';
  var payoutLabel = document.createElement('div');
  payoutLabel.className = 'pat-num-label';
  payoutLabel.textContent = 'Payout ($)';
  payoutField.appendChild(payoutLabel);
  payoutField.appendChild(payoutInput);
  payoutField.appendChild(payoutWarningEl);

  var stemSel = makeSelect('ext-pat-stem',
    [[5,'5 min'],[15,'15 min'],[30,'30 min'],[45,'45 min'],
     [60,'1 h'],[90,'1.5 h'],[120,'2 h'],[150,'2.5 h'],[180,'3 h'],
     [210,'3.5 h'],[240,'4 h'],[480,'8 h'],[720,'12 h'],[1440,'24 h']], 30);

  numsB.appendChild(numField('$/mi', permileInput));
  numsB.appendChild(payoutField);
  numsB.appendChild(numField('Stem Time', stemSel));

  // Per-mile ↔ payout linkage (board distance, not min/max miles)
  permileInput.addEventListener('input', function () {
    if (distMiles <= 0) return;
    var pm = parseFloat(permileInput.value);
    if (!isNaN(pm)) payoutInput.value = (pm * distMiles).toFixed(2);
  });
  payoutInput.addEventListener('input', function () {
    if (distMiles > 0) {
      var po = parseFloat(payoutInput.value);
      if (!isNaN(po)) permileInput.value = (po / distMiles).toFixed(2);
    }
    updateConfirmEnabled();
  });

  // --- Exclude Swing Door checkbox ---
  var swingRow = document.createElement('div');
  swingRow.className = 'pat-checkbox-row';
  var swingCheckbox = document.createElement('input');
  swingCheckbox.setAttribute('type', 'checkbox');
  swingCheckbox.setAttribute('data-testid', 'ext-pat-exclude-swing');
  swingCheckbox.checked = true;
  var swingLabel = document.createElement('label');
  swingLabel.textContent = 'Exclude Swing Door loads';
  swingRow.appendChild(swingCheckbox);
  swingRow.appendChild(swingLabel);

  // --- Row 4: summary ---
  var summaryEl = document.createElement('div');
  summaryEl.setAttribute('data-testid', 'ext-pat-summary');
  summaryEl.className = 'pat-summary';
  // The ownership word is DERIVED now, not the hardcoded "(Provided)" it used to be — an R load
  // reads "Required". WARNING: INTERIM DOM DEPENDENCY; see the block near PAT_TRAILER_BY_LETTER.
  // The separator is U+2003 EM SPACE, preserved byte-for-byte — the layout must not change.
  summaryEl.textContent = "Equipment: " + equipment + " (" + trailerLabel + ") Loading Type: " +
    loadingDispStr;

  // Assemble body
  body.appendChild(routeRow);
  body.appendChild(timesRow);
  body.appendChild(timesWarningEl);
  body.appendChild(numsA);
  body.appendChild(numsB);
  body.appendChild(swingRow);
  body.appendChild(summaryEl);

  // --- Footer ---
  var footer = document.createElement('div');
  footer.className = 'pat-footer';

  var statusEl = document.createElement('div');
  statusEl.setAttribute('data-testid', 'ext-pat-status');
  statusEl.className = 'pat-status';

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'pat-status' +
      (type === 'ok' ? ' pat-status-ok' : type === 'err' ? ' pat-status-err' : '');
  }

  var cancelBtn = document.createElement('button');
  cancelBtn.setAttribute('type', 'button');
  cancelBtn.setAttribute('data-testid', 'ext-pat-cancel');
  cancelBtn.className = 'pat-btn pat-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', removePatModal);

  var confirmBtn = document.createElement('button');
  confirmBtn.setAttribute('type', 'button');
  confirmBtn.setAttribute('data-testid', 'ext-pat-confirm');
  confirmBtn.className = 'pat-btn pat-btn-confirm';
  confirmBtn.textContent = 'Confirm';
  confirmBtn.disabled = true; // enabled after city resolution + a valid payout

  // Single source of truth for the missing-payout and missing-time edge cases: re-run on
  // every payoutInput 'input' event, every time-stepper change, and after city resolution
  // finishes. blockingErrors (TZ / loading type) are permanent for this modal instance —
  // nothing here can clear those.
  function currentPayoutValid() {
    var v = parseFloat(payoutInput.value);
    return !isNaN(v) && v > 0;
  }
  function timesValid() {
    return !!(startStepper.getDate() && endStepper.getDate());
  }
  // Resolved stop count: the parsed board value, or whatever the dispatcher typed when the
  // board value was unreadable. Returns null when still unknown — never 0. This is the ONLY
  // thing the submit path may use for stopCount.
  function currentStopCount() {
    if (!stopCountMissing) return stopCount;
    if (!stopsInput) return null;
    var n = parseInt(stopsInput.value, 10);
    return (isNaN(n) || n < 1) ? null : n;
  }
  function stopsValid() {
    return currentStopCount() !== null;
  }
  // Miles are gated the same way regardless of whether they were prefilled or typed: both
  // must be present and coherent. When the distance was unreadable the fields start empty,
  // so this is false until the dispatcher fills them — which is exactly the intended block.
  function milesValid() {
    var mn = parseFloat(minMilesInput.value);
    var mx = parseFloat(maxMilesInput.value);
    if (isNaN(mn) || isNaN(mx)) return false;
    return mn >= 0 && mx >= mn;
  }
  function updateConfirmEnabled() {
    var payoutOk = currentPayoutValid();
    var timesOk  = timesValid();
    var stopsOk  = stopsValid();
    var milesOk  = milesValid();
    payoutWarningEl.hidden = payoutOk;
    timesWarningEl.hidden  = timesOk;
    // The two new warnings only ever apply to the unreadable-board-value case — a dispatcher
    // who simply cleared a prefilled field gets the disabled Confirm without being told the
    // board data was unreadable, which would be false.
    stopsWarningEl.hidden    = !stopCountMissing || stopsOk;
    distanceWarningEl.hidden = !distanceMissing  || milesOk;
    confirmBtn.disabled = blockingErrors.length > 0 || !originCityObj || !destCityObj ||
                          !payoutOk || !timesOk || !stopsOk || !milesOk;
  }

  footer.appendChild(statusEl);
  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);

  // Show blocking errors immediately (TZ / loading type)
  if (blockingErrors.length > 0) {
    setStatus(blockingErrors.join(' | '), 'err');
    // confirmBtn stays disabled
  }
  updateConfirmEnabled(); // sets initial payout-warning visibility; confirmBtn stays disabled either way (cities unresolved)

  // Assemble and inject modal
  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Drag-by-header: mousedown on header (not the × button) starts dragging.
  // On first drag we snap from CSS transform-center to pixel coordinates, then clamp.
  var dragging = false;
  var dragStartX = 0, dragStartY = 0, modalStartX = 0, modalStartY = 0;
  header.addEventListener('mousedown', function (ev) {
    if (ev.target === headerClose || headerClose.contains(ev.target)) return;
    var rect       = modal.getBoundingClientRect();
    modal.style.top       = rect.top  + 'px';
    modal.style.left      = rect.left + 'px';
    modal.style.transform = 'none';
    dragging    = true;
    dragStartX  = ev.clientX;
    dragStartY  = ev.clientY;
    modalStartX = rect.left;
    modalStartY = rect.top;
    header.style.cursor = 'grabbing';
    ev.preventDefault();
  });
  function onDragMove(ev) {
    if (!dragging) return;
    var newLeft = modalStartX + (ev.clientX - dragStartX);
    var newTop  = modalStartY + (ev.clientY - dragStartY);
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth  - modal.offsetWidth));
    newTop  = Math.max(0, Math.min(newTop,  window.innerHeight - modal.offsetHeight));
    modal.style.left = newLeft + 'px';
    modal.style.top  = newTop  + 'px';
  }
  function onDragEnd() {
    if (dragging) {
      dragging            = false;
      header.style.cursor = '';  // revert to CSS cursor:grab
    }
    if (!overlay.isConnected) {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup',   onDragEnd);
    }
  }
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup',   onDragEnd);

  // Keyboard: Escape closes modal
  function onKeydown(ev) {
    if (ev.key === 'Escape') {
      removePatModal();
      document.removeEventListener('keydown', onKeydown);
    }
  }
  document.addEventListener('keydown', onKeydown);
  // LEAK FIX 2026-08-28 — see removePatModal(). The handle lives on the element so EVERY close
  // path is covered by construction, not by each call site remembering.
  overlay._extPatKeydown = onKeydown;

  // --- Async city resolution (post-render) ---
  var originCityObj = null;
  var destCityObj   = null;

  if (!blockingErrors.length) {
    setStatus('Resolving cities…', '');
  }

  try {
    var cities = await Promise.all([
      resolvePATCity(originInput),
      resolvePATCity(destInput),
    ]);
    if (!overlay.isConnected) return; // modal closed during fetch

    originCityObj = cities[0];
    destCityObj   = cities[1];

    var cityErrors = [];
    if (originCityObj) {
      originNameEl.textContent = originCityObj.displayValue;
      originNameEl.classList.remove('resolving');
    } else {
      cityErrors.push('Could not resolve city: «' + originParsed.city + ', ' + originParsed.state + '» — check logger output');
    }
    if (destCityObj) {
      destNameEl.textContent = destCityObj.displayValue;
      destNameEl.classList.remove('resolving');
    } else {
      cityErrors.push('Could not resolve city: «' + destParsed.city + ', ' + destParsed.state + '» — check logger output');
    }

    if (cityErrors.length > 0 || blockingErrors.length > 0) {
      setStatus((blockingErrors.concat(cityErrors)).join(' | '), 'err');
    } else {
      statusEl.textContent = '';
    }
    updateConfirmEnabled(); // still gated on a valid payout even once cities resolve cleanly
  } catch (e) {
    logger.error('patModal', 'city resolution failed', { error: e });
    if (overlay.isConnected) setStatus('City resolution error — check logger output', 'err');
  }

  logger.log('patModal', 'modal rendered', { loadId: loadId, initPayout: initPayout });

  // --- Confirm handler ---
  confirmBtn.addEventListener('click', function () {
    logger.log('patModal', 'ext-pat-confirm clicked');

    var payoutVal  = parseFloat(payoutInput.value);
    var permileVal = parseFloat(permileInput.value);
    var minMiVal   = parseFloat(minMilesInput.value);
    var maxMiVal   = parseFloat(maxMilesInput.value);

    // Last line of defence, mirroring the payout/times checks. resolvedStopCount is null
    // (never 0) when the board value was unreadable and nothing valid was typed — the
    // previous code passed the fabricated 0 straight into the payload here.
    var resolvedStopCount = currentStopCount();

    if (isNaN(payoutVal) || payoutVal <= 0)  { setStatus('Payout must be a positive number.', 'err'); return; }
    if (resolvedStopCount === null) { setStatus('Stop count could not be read — enter it manually.', 'err'); return; }
    if (isNaN(minMiVal)  || minMiVal < 0)    { setStatus('Min Miles must be 0 or greater.', 'err'); return; }
    if (isNaN(maxMiVal)  || maxMiVal < minMiVal) { setStatus('Max Miles must be ≥ Min Miles.', 'err'); return; }
    if (!loadingTypeList) { setStatus('Unknown loading type — cannot submit.', 'err'); return; }
    if (!originCityObj)   { setStatus('Origin city not resolved — cannot submit.', 'err'); return; }
    if (!destCityObj)     { setStatus('Destination city not resolved — cannot submit.', 'err'); return; }
    if (!startStepper.getDate() || !endStepper.getDate()) { setStatus('Enter both start and end time — cannot submit.', 'err'); return; }

    confirmBtn.disabled = true;
    setStatus('Submitting…', '');

    var formState = {
      originCity:           originCityObj,
      destCity:             destCityObj,
      equipmentTypes:       patEquipmentTypes,
      originRadius:         parseInt(originRadiusSel.value, 10),
      destRadius:           parseInt(destRadiusSel.value, 10),
      startTime:            startStepper.getDate(),
      endTime:              endStepper.getDate(),
      stopCount:            resolvedStopCount,
      minMiles:             minMiVal,
      maxMiles:             maxMiVal,
      permile:              permileVal,
      payout:               payoutVal,
      stemMin:              parseInt(stemSel.value, 10),
      providedTrailerType:  providedTrailerType,
      driverTypes:          driverTypes,
      loadingTypeList:      loadingTypeList,
      excludeSpecialServices: swingCheckbox.checked ? ['SWING_DOOR'] : [],
    };

    var payload = buildPatPayload(formState);

    submitOrder(payload).then(function (result) {
      logger.log('patModal', 'submitOrder result', { ok: result.ok, status: result.status });
      if (!overlay.isConnected) return;
      if (result.ok) {
        setStatus('Post created ✓', 'ok');
        setTimeout(function () {
          overlay.style.transition = 'opacity 0.3s';
          overlay.style.opacity    = '0';
          setTimeout(removePatModal, 300);
        }, 2500);
      } else {
        confirmBtn.disabled = false;
        setStatus('Submission failed (HTTP ' + result.status + ') — see console.', 'err');
      }
    }).catch(function (e) {
      logger.error('patModal', 'submitOrder rejected', { error: e });
      if (overlay.isConnected) {
        confirmBtn.disabled = false;
        setStatus('Unexpected error — see console.', 'err');
      }
    });
  });
}

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.openPostModal  = openPostModal;
window.__EXT_DEBUG.removePatModal = removePatModal;
