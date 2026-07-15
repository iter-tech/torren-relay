// PAT Modal — extension-owned dialog for creating a truck post (carrier offer).
// Opens when dispatcher clicks ext-action-post.
// Pre-fills from loadStore.getLoadUnit(loadId); cities resolved via API call.
// Dispatcher reviews, edits numeric fields, clicks Confirm.
// Confirm POSTs via submitOrder() from patApi.js.
// NO .click() on any Amazon DOM element.
// NO innerHTML with page data — all dynamic text via textContent.
// Every interactive element has data-testid.

var PAT_MODAL_ID = 'ext-pat-modal-overlay';

// PAYOUT TEST MARKUP — silent. Default offer = board payout + $5000.
// The $5000 margin ensures unrealistic pricing during testing (not exposed in the UI).
var PAT_TEST_MARKUP_USD = 5000;

var LOADING_TYPE_DISPLAY = { 'Drop': 'Drop', 'Live': 'Live', 'Live/Drop': 'Drop & Live' };

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
    '#ext-pat-modal .pat-stepper-val{' +
      'flex:1;font-size:12px;color:var(--ext-n900);text-align:center;' +
      'cursor:pointer;text-decoration:underline dotted;user-select:none;' +
    '}' +
    '#ext-pat-modal .pat-stepper-input{' +
      'width:100%;border:1px solid var(--ext-accent);border-radius:var(--ext-radius-sm);' +
      'padding:4px 6px;font-size:12px;background:var(--ext-surface);color:var(--ext-n900);' +
      'box-sizing:border-box;outline:none;' +
    '}' +
    /* Numbers rows */
    '#ext-pat-modal .pat-nums-a{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;}' +
    '#ext-pat-modal .pat-nums-b{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}' +
    '#ext-pat-modal .pat-num-field{display:flex;flex-direction:column;gap:3px;}' +
    '#ext-pat-modal .pat-num-label{font-size:10px;font-weight:600;color:var(--ext-n500);text-transform:uppercase;letter-spacing:.04em;}' +
    '#ext-pat-modal .pat-static-val{font-size:13px;font-weight:600;color:var(--ext-n900);padding:5px 0;}' +
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
// timeResult = { date: Date(UTC), tzName, tzOffset }
// testidBase = e.g. "ext-pat-start"
// Returns { el: HTMLElement, getDate: () => Date }
function makeTimeStepper(timeResult, testidBase) {
  logger.log('patModal', 'makeTimeStepper called', { testidBase: testidBase });
  var cur     = timeResult.date;
  var tzName  = timeResult.tzName;
  var tzOff   = timeResult.tzOffset;

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
  dtInput.style.display = 'none';

  function updateDisplay() {
    valSpan.textContent = formatTimeInTz(cur, tzOff, tzName);
    dtInput.value       = toDatetimeLocalInTz(cur, tzOff);
  }
  updateDisplay();

  minusBtn.addEventListener('click', function () {
    cur = new Date(cur.getTime() - 15 * 60000);
    updateDisplay();
  });
  plusBtn.addEventListener('click', function () {
    cur = new Date(cur.getTime() + 15 * 60000);
    updateDisplay();
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
    if (dtInput.value) {
      var parsed = fromDatetimeLocalInTz(dtInput.value, tzOff);
      if (!isNaN(parsed.getTime())) { cur = parsed; updateDisplay(); }
    }
    dtInput.style.display = 'none';
  });
  dtInput.addEventListener('blur', function () {
    setTimeout(function () { dtInput.style.display = 'none'; }, 200);
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
}

function removePatModal() {
  logger.log('patModal', 'removePatModal called');
  var el = document.getElementById(PAT_MODAL_ID);
  if (el) el.remove();
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

async function openPostModal(loadId) {
  logger.log('patModal', 'openPostModal called', { loadId: loadId });

  if (!loadId) { logger.error('patModal', 'openPostModal: no loadId'); return; }

  var loadUnit = loadStore.getLoadUnit(loadId);
  if (!loadUnit) {
    logger.warn('patModal', 'openPostModal: loadUnit not in store', { loadId: loadId });
    showSimplePatModal('Load data not found — try reopening the load card.', 'pat-no-loadunit');
    return;
  }

  // --- Equipment gate ---
  // Map board label → equipmentTypes array for the upsert. To add a new type: capture a live
  // upsert, add the enum constant in patApi.js, add the mapping here, update api-samples.md.
  var PAT_EQUIPMENT_MAP = {
    "53' Trailer":               PAT_EQUIPMENT_TYPES_53,
    "53' Container and Chassis": PAT_EQUIPMENT_TYPES_CONTAINER,
    "40' Container":             PAT_EQUIPMENT_TYPES_40_CONTAINER,
    "26' Truck":                 PAT_EQUIPMENT_TYPES_26_TRUCK,
  };
  var equipment = loadUnit.equipment || '';
  var patEquipmentTypes = PAT_EQUIPMENT_MAP[equipment] || null;
  if (!patEquipmentTypes) {
    if (!equipment) {
      // Empty equipment means Phase 1 data could not be read from the card DOM at all
      // (on-demand parse in inlinePanel.js already logged outerHTML length + loadId).
      logger.error('patModal', 'openPostModal: empty equipment — card Phase 1 data not available', { loadId: loadId });
      showSimplePatModal(
        "Could not read load data from this card — start the refresh loop once, or report this card layout to the PM.",
        'pat-no-equipment'
      );
    } else {
      logger.warn('patModal', 'openPostModal: unsupported equipment', { equipment: equipment });
      showSimplePatModal(
        "Post creation for this equipment type is not supported yet: «" + equipment + "».\n" +
        "To add it, capture a manual Post-a-Truck upsert for this type and send it to the PM.",
        'pat-unsupported-equipment'
      );
    }
    return;
  }

  // --- Detail check ---
  var detail = loadUnit.detail;
  if (!detail || !detail.segments || detail.segments.length === 0) {
    showSimplePatModal('Load detail not captured — reopen the load card.', 'pat-no-detail');
    return;
  }

  // --- Sync data extraction ---
  var boardStops  = loadUnit.boardStops || [];
  var originStop  = boardStops[0]                              || '';
  var destStop    = boardStops[boardStops.length - 1]          || '';

  // Detail-panel stop objects — used for city resolution, time parsing, and stop count.
  // Declared here (not duplicated below) so both uses share the same references.
  var firstSeg  = detail.segments[0];
  var lastSeg   = detail.segments[detail.segments.length - 1];
  var firstStop = (firstSeg.stops && firstSeg.stops[0]) || null;
  var lastStop  = (lastSeg.stops  && lastSeg.stops[lastSeg.stops.length - 1]) || null;

  // Prefer city from the detail-panel stop address — the same clean "City, ST" text that is
  // displayed in the pick-up/drop-off view. Board card summary stops may carry a 2-letter
  // state-code prefix ("NC CONCORD, NC") that parseBoardStop does not strip (it only handles
  // full-name prefixes like "Illinois AURORA"). Log both side by side to confirm the source.
  var detailOriginParsed = firstStop ? parseDetailAddress(firstStop.address) : null;
  var detailDestParsed   = lastStop  ? parseDetailAddress(lastStop.address)  : null;

  logger.log('patModal', 'openPostModal: city source comparison', {
    boardOrigin:         originStop,
    detailOriginAddress: firstStop ? firstStop.address : null,
    detailOriginParsed:  detailOriginParsed,
    boardDest:           destStop,
    detailDestAddress:   lastStop ? lastStop.address : null,
    detailDestParsed:    detailDestParsed,
  });

  var originParsed, originInput;
  if (detailOriginParsed && detailOriginParsed.city) {
    originParsed = detailOriginParsed;
    originInput  = detailOriginParsed; // resolvePATCity accepts { city, state }
  } else {
    logger.warn('patModal', 'openPostModal: detail origin address unparseable — falling back to boardStop', { originStop: originStop });
    originParsed = parseBoardStop(originStop);
    originInput  = originStop;
  }

  var destParsed, destInput;
  if (detailDestParsed && detailDestParsed.city) {
    destParsed = detailDestParsed;
    destInput  = detailDestParsed;
  } else {
    logger.warn('patModal', 'openPostModal: detail dest address unparseable — falling back to boardStop', { destStop: destStop });
    destParsed = parseBoardStop(destStop);
    destInput  = destStop;
  }

  // payoutNum is pre-parsed by _parsePayoutNum (strips $, commas) — same as parseNumStr.
  // Falls back to parsing the raw payout string directly when payoutNum is null
  // (happens when .wo-total_payout was absent from the card at parse time).
  var boardPayout = loadUnit.payoutNum != null
    ? loadUnit.payoutNum
    : parseNumStr(loadUnit.payout);
  if (loadUnit.payoutNum === null || loadUnit.payoutNum === undefined) {
    logger.warn('patModal', 'openPostModal: payoutNum is null — parseNumStr fallback on raw payout string', {
      loadId: loadId, payout: loadUnit.payout, resolvedTo: boardPayout,
    });
  }
  var initPayout  = parseFloat((boardPayout + PAT_TEST_MARKUP_USD).toFixed(2));

  var distMiles = parseNumStr(loadUnit.distance);
  var minMiles  = Math.max(0, Math.round(distMiles) - 25);
  var maxMiles  = Math.round(distMiles) + 25;
  var initPermile = distMiles > 0 ? (initPayout / distMiles).toFixed(2) : '0.00';

  var stopsCountStr = (detail.header && detail.header.stopsCount) || '';
  var stopCount     = parseInt(stopsCountStr, 10) || 0;

  var loadingTypeStr  = loadUnit.loadingType || '';
  var loadingTypeList = resolveLoadingType(loadingTypeStr);
  var loadingDispStr  = LOADING_TYPE_DISPLAY[loadingTypeStr] || loadingTypeStr;

  // Times from first/last stop arrivals (firstStop/lastStop declared in sync extraction above)
  var startTimeResult = firstStop ? parsePatStopTime(firstStop.arrival) : null;
  var endTimeResult   = lastStop  ? parsePatStopTime(lastStop.arrival)  : null;

  // Collect blocking errors
  var blockingErrors = [];
  if (!loadingTypeList) blockingErrors.push('Unknown loading type: «' + loadingTypeStr + '»');
  if (startTimeResult && startTimeResult.tzError) {
    blockingErrors.push('Unrecognized timezone: «' + startTimeResult.tzError + '» in start time');
    startTimeResult = null;
  }
  if (endTimeResult && endTimeResult.tzError) {
    blockingErrors.push('Unrecognized timezone: «' + endTimeResult.tzError + '» in end time');
    endTimeResult = null;
  }

  // Default time results if parse failed
  function fallbackTime(plusHours) {
    return { date: new Date(Date.now() + plusHours * 3600000), tzName: 'UTC', tzOffset: 0 };
  }
  if (!startTimeResult) startTimeResult = fallbackTime(1);
  if (!endTimeResult)   endTimeResult   = fallbackTime(4);

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

  var startStepper = makeTimeStepper(startTimeResult, 'ext-pat-start');
  var endStepper   = makeTimeStepper(endTimeResult,   'ext-pat-end');
  var timesArrow   = document.createElement('div');
  timesArrow.className = 'pat-route-arrow';
  timesArrow.textContent = '→';

  timesRow.appendChild(startStepper.el);
  timesRow.appendChild(timesArrow);
  timesRow.appendChild(endStepper.el);

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

  var stopsVal = document.createElement('div');
  stopsVal.setAttribute('data-testid', 'ext-pat-stops');
  stopsVal.className = 'pat-static-val';
  stopsVal.textContent = stopsCountStr || (stopCount + ' Stops');

  var minMilesInput = document.createElement('input');
  minMilesInput.setAttribute('type', 'number');
  minMilesInput.setAttribute('data-testid', 'ext-pat-min-miles');
  minMilesInput.setAttribute('min', '0');
  minMilesInput.setAttribute('step', '1');
  minMilesInput.value = String(minMiles);

  var maxMilesInput = document.createElement('input');
  maxMilesInput.setAttribute('type', 'number');
  maxMilesInput.setAttribute('data-testid', 'ext-pat-max-miles');
  maxMilesInput.setAttribute('min', '0');
  maxMilesInput.setAttribute('step', '1');
  maxMilesInput.value = String(maxMiles);

  var driverVal = document.createElement('div');
  driverVal.setAttribute('data-testid', 'ext-pat-driver');
  driverVal.className = 'pat-static-val';
  driverVal.textContent = 'Solo';

  numsA.appendChild(numField('Stops', stopsVal));
  numsA.appendChild(numField('Min Miles', minMilesInput));
  numsA.appendChild(numField('Max Miles', maxMilesInput));
  numsA.appendChild(numField('Driver', driverVal));

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
  payoutInput.value = initPayout.toFixed(2);

  var stemSel = makeSelect('ext-pat-stem',
    [[5,'5 min'],[15,'15 min'],[30,'30 min'],[45,'45 min'],
     [60,'1 h'],[90,'1.5 h'],[120,'2 h'],[150,'2.5 h'],[180,'3 h'],
     [210,'3.5 h'],[240,'4 h'],[480,'8 h'],[720,'12 h'],[1440,'24 h']], 30);

  numsB.appendChild(numField('$/mi', permileInput));
  numsB.appendChild(numField('Payout ($)', payoutInput));
  numsB.appendChild(numField('Stem Time', stemSel));

  // Per-mile ↔ payout linkage (board distance, not min/max miles)
  permileInput.addEventListener('input', function () {
    if (distMiles <= 0) return;
    var pm = parseFloat(permileInput.value);
    if (!isNaN(pm)) payoutInput.value = (pm * distMiles).toFixed(2);
  });
  payoutInput.addEventListener('input', function () {
    if (distMiles <= 0) return;
    var po = parseFloat(payoutInput.value);
    if (!isNaN(po)) permileInput.value = (po / distMiles).toFixed(2);
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
  summaryEl.textContent = "Equipment: " + equipment + " (Provided) Loading Type: " + loadingDispStr;

  // Assemble body
  body.appendChild(routeRow);
  body.appendChild(timesRow);
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
  confirmBtn.disabled = true; // enabled after city resolution

  footer.appendChild(statusEl);
  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);

  // Show blocking errors immediately (TZ / loading type)
  if (blockingErrors.length > 0) {
    setStatus(blockingErrors.join(' | '), 'err');
    // confirmBtn stays disabled
  }

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
      // confirmBtn stays disabled
    } else {
      statusEl.textContent = '';
      confirmBtn.disabled  = false;
    }
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

    if (isNaN(payoutVal) || payoutVal <= 0)  { setStatus('Payout must be a positive number.', 'err'); return; }
    if (isNaN(minMiVal)  || minMiVal < 0)    { setStatus('Min Miles must be 0 or greater.', 'err'); return; }
    if (isNaN(maxMiVal)  || maxMiVal < minMiVal) { setStatus('Max Miles must be ≥ Min Miles.', 'err'); return; }
    if (!loadingTypeList) { setStatus('Unknown loading type — cannot submit.', 'err'); return; }
    if (!originCityObj)   { setStatus('Origin city not resolved — cannot submit.', 'err'); return; }
    if (!destCityObj)     { setStatus('Destination city not resolved — cannot submit.', 'err'); return; }

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
      stopCount:            stopCount,
      minMiles:             minMiVal,
      maxMiles:             maxMiVal,
      permile:              permileVal,
      payout:               payoutVal,
      stemMin:              parseInt(stemSel.value, 10),
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
