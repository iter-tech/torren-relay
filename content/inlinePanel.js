// Read-only module — reads Amazon's native #selected-work-sheet and renders
// our own collapsible segmented summary panel injected below the clicked load card.
// NO clicks on Amazon elements, NO booking, NO hiding or modifying the native sheet.

var PANEL_ID                  = 'ext-inline-panel';
var SHEET_SELECTOR            = '#selected-work-sheet';
var currentPanelCard          = null; // owned by showInlinePanel (set on success) and removeInlinePanel (clear)
var _fastBookStorageListener  = null; // storage.onChanged listener for Fast Book visibility — cleaned up in removeInlinePanel

function injectPanelStyle() {
  if (document.getElementById('ext-inline-panel-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-inline-panel-style';
  style.textContent =
    '.ext-inline-panel{' +
      'border:1px solid var(--ext-n200);border-radius:4px;margin:0 0 12px 0;' +
      'font-family:Arial,sans-serif;font-size:13px;background:var(--ext-surface);overflow:hidden;' +
    '}' +
    '.ext-inline-panel__header{' +
      'background:var(--ext-accent-bg);color:var(--ext-accent-text);padding:8px 14px;' +
      'display:flex;gap:14px;align-items:center;font-size:12px;' +
    '}' +
    '.ext-inline-panel__header .ext-payout{' +
      'margin-left:auto;font-weight:bold;' +
    '}' +
    '.ext-seg-header{' +
      'background:var(--ext-n100);border-top:1px solid var(--ext-n200);padding:10px 14px;' +
      'display:grid;grid-template-columns:40px minmax(0,3fr) 1.4fr 1fr 1fr 32px;' +
      'gap:0;align-items:center;' +
      'font-size:12px;color:var(--ext-n700);cursor:pointer;user-select:none;' +
    '}' +
    '.ext-seg-header > span{padding:0 8px;}' +
    '.ext-seg-route{min-width:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;}' +
    '.ext-route-origin{' +
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;' +
      'overflow-wrap:break-word;word-break:break-word;min-width:0;text-align:center;' +
    '}' +
    '.ext-route-dest{' +
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;' +
      'overflow-wrap:break-word;word-break:break-word;min-width:0;text-align:center;' +
    '}' +
    '.ext-route-arrow{font-size:1.15em;font-weight:700;color:var(--ext-n400);margin:0 0.35em;}' +
    '.ext-seg-dist{color:var(--ext-n500);font-size:11px;text-align:center;}' +
    '.ext-seg-action{text-align:center;font-size:11px;color:var(--ext-n700);}' +
    '.ext-seg-status{text-align:center;font-size:11px;}' +
    '.ext-seg-loaded{color:var(--ext-success);font-weight:500;}' +
    '.ext-seg-empty{color:var(--ext-n500);}' +
    '.ext-seg-header .ext-seg-title{display:flex;align-items:center;justify-content:center;padding:0;}' +
    '.ext-seg-header .ext-seg-arrow{transition:transform .15s;text-align:center;padding:0 4px;}' +
    '.ext-seg-header.ext-open .ext-seg-arrow{transform:rotate(180deg);}' +
    '.ext-seg-body{display:none;}' +
    '.ext-seg-body.ext-open{display:block;}' +
    '.ext-inline-panel__table{width:100%;border-collapse:collapse;table-layout:fixed;}' +
    '.ext-inline-panel__table th:nth-child(1),.ext-inline-panel__table td:nth-child(1){width:40%;}' +
    '.ext-inline-panel__table th:nth-child(2),.ext-inline-panel__table td:nth-child(2){width:20%;}' +
    '.ext-inline-panel__table th:nth-child(3),.ext-inline-panel__table td:nth-child(3){width:20%;}' +
    '.ext-inline-panel__table th:nth-child(4),.ext-inline-panel__table td:nth-child(4){width:20%;}' +
    '.ext-inline-panel__table th{' +
      'text-align:left;font-size:11px;color:var(--ext-n500);font-weight:bold;' +
      'padding:8px 14px;border-bottom:1px solid var(--ext-n200);' +
    '}' +
    '.ext-inline-panel__table td{' +
      'padding:10px 14px;border-bottom:1px solid var(--ext-n100);vertical-align:top;word-break:break-word;' +
    '}' +
    '.ext-stop-num{' +
      'display:inline-flex;width:18px;height:18px;border-radius:50%;' +
      'background:var(--ext-accent-bg);color:var(--ext-accent-text);font-size:11px;' +
      'align-items:center;justify-content:center;margin-right:8px;' +
    '}' +
    '.ext-seg-title .ext-stop-num{margin-right:0;}' +
    '.ext-stop-addr{color:var(--ext-n500);font-size:12px;}' +
    '.ext-dot-loaded{' +
      'display:inline-block;width:11px;height:11px;border-radius:50%;' +
      'background:var(--ext-n900);margin-right:6px;vertical-align:middle;' +
    '}' +
    '.ext-dot-empty{' +
      'display:inline-block;width:11px;height:11px;border-radius:50%;' +
      'border:1.5px solid var(--ext-n900);margin-right:6px;vertical-align:middle;' +
    '}' +
    '.ext-action-bar{' +
      'border-top:1px solid var(--ext-n200);padding:5px 10px;' +
      'display:flex;gap:4px;background:var(--ext-n100);' +
    '}' +
    '.ext-action-btn{' +
      'width:28px;height:28px;border:none;background:none;border-radius:4px;' +
      'cursor:pointer;color:var(--ext-n400);display:inline-flex;align-items:center;' +
      'justify-content:center;padding:0;transition:background .15s,color .15s;' +
    '}' +
    '.ext-action-btn:hover{background:var(--ext-n200);color:var(--ext-n900);}' +
    '.ext-action-btn:focus-visible{outline:2px solid var(--ext-accent);outline-offset:2px;}' +
    '.ext-action-btn svg{width:15px;height:15px;display:block;}' +
    '.ext-action-btn--fastbook{' +
      'width:auto;padding:0 8px;font-size:11px;font-weight:600;letter-spacing:0.02em;' +
      'margin-left:auto;' +
      'color:#ffffff;border:none;border-radius:4px;background:#2563eb;' +
    '}' +
    '.ext-action-btn--fastbook:hover{background:#1d4ed8;color:#ffffff;}' +
    '.ext-action-btn--fastbook:disabled{opacity:0.6;cursor:not-allowed;}';
  document.head.appendChild(style);
}

// Executes the two-step Fast Book sequence: click Amazon's Book button, then click Confirm.
// Triggered ONLY by user's explicit Fast Book button click (Click 4 in SAFETY.md).
// isForbiddenElement() is called before each Amazon DOM click per the binding safety rule.
function executeFastBook(sheetLoadId, fastBookBtn) {
  logger.log('inlinePanel', 'executeFastBook called', { loadId: sheetLoadId, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });

  if (fastBookBtn) {
    fastBookBtn.disabled = true;
    fastBookBtn.textContent = 'Booking...';
  }

  var sheet = document.querySelector(SHEET_SELECTOR);
  if (!sheet) {
    logger.error('inlinePanel', 'executeFastBook: sheet not found', { selector: SHEET_SELECTOR });
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return;
  }

  // Step 1: find Amazon's Book button
  var bookBtn = sheet.querySelector('#rlb-book-btn');
  if (!bookBtn) {
    // Fallback: first <button> in sheet with exact text "Book"
    var sheetBtns = sheet.querySelectorAll('button');
    for (var i = 0; i < sheetBtns.length; i++) {
      if (sheetBtns[i].textContent.trim() === 'Book') { bookBtn = sheetBtns[i]; break; }
    }
  }
  if (!bookBtn) {
    logger.error('inlinePanel', 'executeFastBook: Book button not found in sheet');
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return;
  }
  if (isForbiddenElement(bookBtn)) {
    logger.error('inlinePanel', 'executeFastBook: bookBtn matched FORBIDDEN_SELECTORS — aborting', { id: bookBtn.id });
    if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    return;
  }

  logger.log('inlinePanel', 'executeFastBook: clicking Book button', { id: bookBtn.id, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });
  bookBtn.click();

  // Step 2: poll for Amazon's confirm dialog button and click it
  var MAX_WAIT_MS   = 5000;
  var POLL_MS       = 100;
  var elapsed       = 0;
  var pollInterval  = setInterval(function () {
    elapsed += POLL_MS;
    var confirmBtn = document.querySelector('#rlb-book-trip-confirm-booking-btn');
    if (!confirmBtn) {
      // Fallback: button with text "Book" inside any modal/overlay that appeared after step 1
      var allBtns = document.querySelectorAll('button');
      for (var j = 0; j < allBtns.length; j++) {
        var t = allBtns[j].textContent.trim();
        if (t === 'Book' || t === 'Confirm' || t === 'Confirm booking') { confirmBtn = allBtns[j]; break; }
      }
    }
    if (confirmBtn && confirmBtn !== bookBtn) {
      clearInterval(pollInterval);
      if (isForbiddenElement(confirmBtn)) {
        logger.error('inlinePanel', 'executeFastBook: confirmBtn matched FORBIDDEN_SELECTORS — aborting', { id: confirmBtn.id });
        if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
        return;
      }
      logger.log('inlinePanel', 'executeFastBook: clicking confirm button', { id: confirmBtn.id, intent: ALLOWED_CLICK_INTENTS.FAST_BOOK });
      confirmBtn.click();
      if (fastBookBtn) {
        fastBookBtn.textContent = 'Booked!';
      }
    } else if (elapsed >= MAX_WAIT_MS) {
      clearInterval(pollInterval);
      logger.error('inlinePanel', 'executeFastBook: confirm button not found within timeout', { elapsed: elapsed });
      if (fastBookBtn) { fastBookBtn.disabled = false; fastBookBtn.textContent = 'Fast Book'; }
    }
  }, POLL_MS);
}

// Returns a cheap string fingerprint of the currently open detail sheet.
// Composed of payout text, expander count, and first stop label — enough to detect
// when Amazon has replaced the previous card's sheet with the new card's sheet.
function sheetFingerprint(sheet) {
  var payoutEl    = sheet.querySelector('.css-6hcxnp');
  var payout      = payoutEl ? payoutEl.textContent : '';
  var expanders   = sheet.querySelectorAll('.load-expander').length;
  var firstNameEl = sheet.querySelector('.css-424exj');
  var firstName   = firstNameEl ? firstNameEl.textContent : '';
  return payout + '|' + expanders + '|' + firstName;
}

// Polls until Amazon's native sheet has rendered segments AND its fingerprint has changed
// from prevFingerprint (when provided — guards against reading the previous card's stale sheet).
// prevFingerprint is null/undefined when no sheet was open before clicking; in that case any
// sheet with .load-expander is accepted immediately.
// Hard timeout: 1500ms — callback fires regardless; downstream handles null/stale data.
function waitForSheet(callback, prevFingerprint) {
  var POLL_MS = 50;
  var MAX_MS  = 1500;
  var elapsed = 0;
  var interval = setInterval(function () {
    elapsed += POLL_MS;
    var sheet       = document.querySelector(SHEET_SELECTOR);
    var hasExpander = sheet && sheet.querySelector('.load-expander');
    var ready;
    if (prevFingerprint == null) {
      ready = !!hasExpander;
    } else {
      ready = !!(hasExpander && sheetFingerprint(sheet) !== prevFingerprint);
    }
    if (ready || elapsed >= MAX_MS) {
      clearInterval(interval);
      callback();
    }
  }, POLL_MS);
}

function parseStopBlock(block) {
  var addrContainer = block.querySelector('.css-w1kk5u');
  var name          = '';
  var addressLines  = [];

  if (addrContainer) {
    var paras = addrContainer.querySelectorAll('p');
    paras.forEach(function (p) {
      var bold = p.querySelector('b');
      if (bold) {
        name = bold.textContent.trim();
      }
      var text = p.textContent.trim();
      if (text) addressLines.push(text);
    });
    addressLines = addressLines.filter(function (line) { return line !== name; });
  }

  var address = addressLines.join(', ');

  var arrivalEl   = block.querySelector('.scheduled-arrival__time .scheduled-time');
  var departureEl = block.querySelector('.scheduled-departure__time .scheduled-time');
  var arrival     = arrivalEl   ? arrivalEl.textContent.trim()   : '';
  var departure   = departureEl ? departureEl.textContent.trim() : '';

  // Equipment text + load type — both extracted from the same .css-1cbogyo block
  // that contains "Trailer". Normalized text looks like: "Equipment/ID 53' Trailer Drop"
  var equipmentText = '';
  var loadType      = '';
  var equipEls      = block.querySelectorAll('.css-1cbogyo');
  equipEls.forEach(function (eq) {
    if (eq.textContent.indexOf('Trailer') !== -1) {
      var normalized   = eq.textContent.replace(/\s+/g, ' ').trim();
      var trailerMatch = normalized.match(/\d+'\s*Trailer/);
      equipmentText    = trailerMatch ? trailerMatch[0].trim() : '';
      var statusMatch  = normalized.match(/Trailer\s+(Live|Drop|Preloaded)/i);
      if (statusMatch) {
        var raw = statusMatch[1].toLowerCase();
        if      (raw === 'live')      loadType = 'Live';
        else if (raw === 'drop')      loadType = 'Drop';
        else if (raw === 'preloaded') loadType = 'Preloaded';
      }
    }
  });

  // Loaded flag — first matching circle icon only; classList.contains avoids substring match
  var loaded   = false;
  var dotIcons = block.querySelectorAll('i.fa-circle, i.fa-circle-o');
  for (var d = 0; d < dotIcons.length; d++) {
    var icon = dotIcons[d];
    if (icon.classList.contains('fa-circle-o')) {
      loaded = false;
    } else if (icon.classList.contains('fa-circle')) {
      loaded = true;
    }
    break;
  }

  return {
    num:           '',
    name:          name,
    address:       address,
    equipmentText: equipmentText,
    loadType:      loadType,
    loaded:        loaded,
    arrival:       arrival,
    departure:     departure
  };
}

function readSheetData() {
  try {
    var sheet = document.querySelector(SHEET_SELECTOR);
    if (!sheet) {
      logger.warn('inlinePanel', 'readSheetData: sheet not found', { selector: SHEET_SELECTOR });
      return null;
    }

    // Header summary — stopsCount + totalMiles
    var stopsCount    = '';
    var totalMiles    = '';
    var headerSummary = sheet.querySelector('.css-ntd8uw .css-1q48g4q');
    if (headerSummary) {
      var summaryPs = headerSummary.querySelectorAll('p');
      if (summaryPs[0]) stopsCount = summaryPs[0].textContent.trim();
      if (summaryPs[1]) totalMiles = summaryPs[1].textContent.trim();
    }

    // Payout
    var payoutEl = sheet.querySelector('.css-6hcxnp');
    var payout   = payoutEl ? payoutEl.textContent.trim() : null;

    // Segments — one per .load-expander
    var loadExpanders = sheet.querySelectorAll('.load-expander');

    // Selector-drift alarm: .load-expander is a non-hashed class (stable); its absence
    // while the sheet exists may indicate Amazon changed the DOM structure.
    if (loadExpanders.length === 0) {
      logger.warn('inlinePanel', 'SELECTOR DRIFT SUSPECTED: sheet present but no .load-expander found — Amazon may have rebuilt CSS classes or DOM structure');
    }

    var segments = [];

    loadExpanders.forEach(function (expander) {
      // Segment header (id="#expanded-header" is reused; query within this expander)
      var segHeaderEl = expander.querySelector('#expanded-header');
      var fromName    = '';
      var toName      = '';
      var miles       = '';

      if (segHeaderEl) {
        var stopLabels = segHeaderEl.querySelectorAll('.css-17jtd1r');
        if (stopLabels[0]) {
          var fn = stopLabels[0].querySelector('.css-424exj');
          fromName = fn ? fn.textContent.trim() : '';
        }
        if (stopLabels[1]) {
          var tn = stopLabels[1].querySelector('.css-424exj');
          toName = tn ? tn.textContent.trim() : '';
        }
        var milesEl = segHeaderEl.querySelector('.css-14f9df9');
        miles = milesEl ? milesEl.textContent.trim() : '';
      }

      var fromTo = fromName + ' → ' + toName;

      // Duration — extract token after first bullet if present
      var duration   = '';
      var durationEl = expander.querySelector('.css-gudqq2 .css-1cp4is8');
      if (durationEl) {
        var dText  = durationEl.textContent;
        var bullet = dText.indexOf('•');
        if (bullet !== -1) {
          duration = dText.slice(bullet + 1).trim().split('•')[0].trim();
        }
      }

      // Stops from expander-content
      var content = expander.querySelector('.expander-content');
      var stops   = [];
      if (content) {
        var stopBlocks = content.querySelectorAll('.css-zgauvq');
        stopBlocks.forEach(function (block) {
          var stop = parseStopBlock(block);
          if (!stop.address && !stop.arrival) return;
          stops.push(stop);
        });
      }

      // De-duplicate stops within this segment by arrival+departure time.
      // Fresh seen object per segment — no cross-segment dedup.
      var seen         = {};
      var dedupedStops = [];
      for (var s = 0; s < stops.length; s++) {
        var stop    = stops[s];
        var timeKey = stop.arrival + '|' + stop.departure;
        if (stop.arrival && stop.departure) {
          if (seen[timeKey]) continue;
          seen[timeKey] = true;
        }
        dedupedStops.push(stop);
      }

      // segment.loaded = true if ANY stop in dedupedStops is loaded
      var segLoaded = false;
      for (var k = 0; k < dedupedStops.length; k++) {
        if (dedupedStops[k].loaded) { segLoaded = true; break; }
      }

      // segment.loadType = loadType of the LAST stop (delivery reflects what happens at destination)
      var segLoadType = '';
      if (dedupedStops.length > 0) {
        segLoadType = dedupedStops[dedupedStops.length - 1].loadType || '';
      }

      segments.push({
        idLabel:  '',
        fromTo:   fromTo,
        miles:    miles,
        duration: duration,
        loadType: segLoadType,
        loaded:   segLoaded,
        price:    '',
        stops:    dedupedStops
      });
    });

    // Selector-drift alarm: if segments were found but every one has 0 stops AND
    // empty fromTo, all the hashed css- class selectors likely returned nothing.
    if (segments.length > 0) {
      var allSegmentsEmpty = segments.every(function (seg) {
        return seg.stops.length === 0 && seg.fromTo.trim() === '→';
      });
      if (allSegmentsEmpty) {
        logger.warn('inlinePanel', 'SELECTOR DRIFT SUSPECTED: sheet present but all hashed selectors returned empty — Amazon may have rebuilt CSS classes');
      }
    }

    // Assign global stop numbers using a cumulative counter.
    // Boundary stops (first stop of each non-first segment, n>0 && sn===0) share
    // the previous segment's last number — counter is NOT advanced for them.
    // Correct for segments with any stop count (old per-segment formula assumed exactly 2).
    // Example (3 segments × 2 stops → 1,2 / 2,3 / 3,4):
    //   seg 0: stops[0].num="1"  stops[1].num="2"
    //   seg 1: stops[0].num="2"  stops[1].num="3"   ← 2 shared with seg 0 end
    //   seg 2: stops[0].num="3"  stops[1].num="4"   ← 3 shared with seg 1 end
    var stopCounter = 1;
    for (var n = 0; n < segments.length; n++) {
      var segStops = segments[n].stops;
      for (var sn = 0; sn < segStops.length; sn++) {
        if (n > 0 && sn === 0) {
          // Boundary stop: shares the previous segment's last number (counter - 1).
          segStops[sn].num = String(stopCounter - 1);
        } else {
          segStops[sn].num = String(stopCounter);
          stopCounter++;
        }
      }
    }

    // Route = first segment from-name → last segment to-name
    var route = '';
    if (segments.length > 0) {
      var firstParts = segments[0].fromTo.split(' → ');
      var lastParts  = segments[segments.length - 1].fromTo.split(' → ');
      route = (firstParts[0] || '') + ' → ' + (lastParts[lastParts.length - 1] || '');
    }

    return {
      header: {
        route:      route,
        stopsCount: stopsCount,
        totalMiles: totalMiles,
        payout:     payout
      },
      segments: segments
    };

  } catch (e) {
    logger.error('inlinePanel', 'readSheetData failed', { error: e });
    return null;
  }
}

// Builds the stops <table> for a segment — shared by both single and multi rendering.
function buildSegmentTable(segment) {
  var table = document.createElement('table');
  table.className = 'ext-inline-panel__table';

  var thead   = document.createElement('thead');
  var headRow = document.createElement('tr');
  ['Stop', 'Equipment / Id', 'Arrival', 'Departure'].forEach(function (label) {
    var th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');

  segment.stops.forEach(function (stop) {
    var tr = document.createElement('tr');

    // td1 — optional stop-num + name + address
    var td1 = document.createElement('td');
    if (stop.num) {
      var numSpan = document.createElement('span');
      numSpan.className = 'ext-stop-num';
      numSpan.textContent = String(stop.num);
      td1.appendChild(numSpan);
    }
    var nameEl = document.createElement('b');
    nameEl.textContent = stop.name;
    var addrDiv = document.createElement('div');
    addrDiv.className = 'ext-stop-addr';
    addrDiv.textContent = stop.address;
    td1.appendChild(nameEl);
    td1.appendChild(addrDiv);

    // td2 — loaded dot + equipment text
    var td2 = document.createElement('td');
    var dot = document.createElement('span');
    dot.className = stop.loaded ? 'ext-dot-loaded' : 'ext-dot-empty';
    td2.appendChild(dot);
    td2.appendChild(document.createTextNode(stop.equipmentText));

    // td3 — arrival
    var td3 = document.createElement('td');
    td3.textContent = stop.arrival;

    // td4 — departure
    var td4 = document.createElement('td');
    td4.textContent = stop.departure;

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

// Swaps the action button icon to a green checkmark for ~1 s, then restores it.
// Called by captureCardToClipboard on success.
function flashActionSuccess(btn) {
  logger.log('inlinePanel', 'flashActionSuccess called');
  var original      = btn.innerHTML;
  var originalTitle = btn.getAttribute('title'); // null when attribute absent
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="#157347"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true"><path d="M2 8l4 4 8-8"/></svg>';
  btn.setAttribute('title', 'Copied!');
  setTimeout(function () {
    btn.innerHTML = original;
    // Restore title exactly: removeAttribute when the original had none, to avoid
    // setAttribute(title, null) writing the string "null".
    if (originalTitle === null) {
      btn.removeAttribute('title');
    } else {
      btn.setAttribute('title', originalTitle);
    }
  }, 1100);
}

// Captures cardElement to a PNG via html2canvas and writes it to the clipboard.
// btn is the camera button — used for the success flash.
// The click on btn is the required user gesture; no extra permission prompt fires
// when clipboardWrite is granted in manifest.json.
function captureCardToClipboard(cardElement, btn) {
  logger.log('inlinePanel', 'captureCardToClipboard called');
  html2canvas(cardElement, {
    scale:           window.devicePixelRatio || 1,
    useCORS:         true,
    allowTaint:      false,
    backgroundColor: '#ffffff',
    logging:         false
  }).then(function (canvas) {
    canvas.toBlob(function (blob) {
      if (!blob) {
        logger.error('inlinePanel', 'captureCardToClipboard: toBlob returned null');
        return;
      }
      navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]).then(function () {
        logger.log('inlinePanel', 'captureCardToClipboard: copied to clipboard OK');
        flashActionSuccess(btn);
      }).catch(function (e) {
        logger.error('inlinePanel', 'captureCardToClipboard: clipboard write failed', { error: e });
      });
    }, 'image/png');
  }).catch(function (e) {
    logger.error('inlinePanel', 'captureCardToClipboard: html2canvas failed', { error: e });
  });
}

// Collects unique stops in global order (boundary stops appear in adjacent segments),
// builds a Google Maps Directions URL, and opens it in a new tab.
function openRouteInMaps(data) {
  logger.log('inlinePanel', 'openRouteInMaps called');
  var allStops = [];
  var seen = {};
  data.segments.forEach(function (seg) {
    seg.stops.forEach(function (stop) {
      var key = stop.num || (stop.name + '|||' + stop.address);
      if (!seen[key]) {
        seen[key] = true;
        allStops.push(stop);
      }
    });
  });
  if (allStops.length < 2) {
    logger.warn('inlinePanel', 'openRouteInMaps: fewer than 2 unique stops', { count: allStops.length });
    return;
  }
  function stopLabel(stop) {
    var addr = stop.address ? stop.address.trim() : '';
    return addr ? (stop.name + ' ' + addr) : stop.name;
  }
  var origin      = encodeURIComponent(stopLabel(allStops[0]));
  var destination = encodeURIComponent(stopLabel(allStops[allStops.length - 1]));
  var url = 'https://www.google.com/maps/dir/?api=1' +
    '&origin='      + origin +
    '&destination=' + destination +
    '&travelmode=driving';
  if (allStops.length > 2) {
    var waypoints = allStops.slice(1, -1)
      .map(function (stop) { return encodeURIComponent(stopLabel(stop)); })
      .join('|');
    url += '&waypoints=' + waypoints;
  }
  logger.log('inlinePanel', 'openRouteInMaps: opening map', { stops: allStops.length });
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Builds the three-button icon row rendered at the bottom of every inline panel.
// Click handlers for wired buttons are attached by showInlinePanel(), not here.
function buildActionBar() {
  logger.log('inlinePanel', 'buildActionBar called');

  var bar = document.createElement('div');
  bar.className = 'ext-action-bar';
  bar.setAttribute('data-testid', 'ext-action-bar');

  // Icon definitions: [ testid, aria-label, svg-inner-html ]
  // SVGs are static markup (no page data), stroke-based 16×16, consistent with
  // popup.html icon style. innerHTML is safe here — no user/page data involved.
  var icons = [
    [
      'ext-action-camera',
      'Screenshot',
      '<path d="M1 6h2.5l1.5-2.5h6L12.5 6H15v8H1z"/>' +
      '<circle cx="8" cy="10" r="2.2"/>'
    ],
    [
      'ext-action-map',
      'Route map',
      '<path d="M8 14s-5-4.2-5-8a5 5 0 0 1 10 0c0 3.8-5 8-5 8z"/>' +
      '<circle cx="8" cy="6" r="1.6"/>'
    ],
    [
      'ext-action-post',
      'Create post',
      '<path d="M3 1.5h6.5L13 5v9.5H3z"/>' +
      '<path d="M9.5 1.5V5H13"/>' +
      '<line x1="6.2" y1="9.2" x2="9.8" y2="9.2"/>' +
      '<line x1="8" y1="7.4" x2="8" y2="11"/>'
    ]
  ];

  icons.forEach(function (def) {
    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-testid', def[0]);
    btn.setAttribute('aria-label', def[1]);
    btn.setAttribute('title', def[1]);
    btn.className = 'ext-action-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"' +
      ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' + def[2] + '</svg>';
    bar.appendChild(btn);
  });

  // Fast Book button — text only, hidden until fastBookEnabled is confirmed
  var fastBookBtn = document.createElement('button');
  fastBookBtn.setAttribute('type', 'button');
  fastBookBtn.setAttribute('data-testid', 'ext-action-fastbook');
  fastBookBtn.setAttribute('aria-label', 'Fast Book — instantly book this load');
  fastBookBtn.setAttribute('title', 'Fast Book — instantly book this load');
  fastBookBtn.className = 'ext-action-btn ext-action-btn--fastbook';
  fastBookBtn.textContent = 'Fast Book';
  fastBookBtn.style.display = 'none';
  bar.appendChild(fastBookBtn);

  return bar;
}

function buildPanelElement(data) {
  var panel = document.createElement('div');
  panel.className = 'ext-inline-panel';

  var multi = data.segments.length > 1;

  data.segments.forEach(function (segment, i) {
    if (multi) {
      // Two or more segments — collapsible grey header, body collapsed by default
      var segHeader = document.createElement('div');
      segHeader.className = 'ext-seg-header';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'ext-seg-title';
      // Use stops[0].num when stops exist; fall back to formula only when stops are empty.
      var originNum   = segment.stops.length > 0 ? segment.stops[0].num : String(i + 1);
      var originNumEl = document.createElement('span');
      originNumEl.className  = 'ext-stop-num';
      originNumEl.textContent = originNum;
      titleSpan.appendChild(originNumEl);

      // Route column — origin, bold accent arrow, destination as separate nodes.
      // Never uses innerHTML; each part set via textContent.
      var fromToSpan = document.createElement('span');
      fromToSpan.className = 'ext-seg-route';

      var routeParts = segment.fromTo.split(' → ');
      var originText = routeParts[0] || '';
      var destText   = routeParts.length > 1 ? routeParts.slice(1).join(' → ') : '';

      var originEl = document.createElement('span');
      originEl.className  = 'ext-route-origin';
      originEl.textContent = originText;

      var routeArrowEl = document.createElement('span');
      routeArrowEl.className  = 'ext-route-arrow';
      routeArrowEl.textContent = '→';

      var destEl = document.createElement('span');
      destEl.className  = 'ext-route-dest';
      // Use last stop's num when stops exist; fall back to formula only when stops are empty.
      var destNum   = segment.stops.length > 0
        ? segment.stops[segment.stops.length - 1].num
        : String(i + 2);
      var destNumEl = document.createElement('span');
      destNumEl.className  = 'ext-stop-num';
      destNumEl.textContent = destNum;
      destEl.appendChild(destNumEl);
      destEl.appendChild(document.createTextNode(destText));

      fromToSpan.appendChild(originEl);
      fromToSpan.appendChild(routeArrowEl);
      fromToSpan.appendChild(destEl);

      // Distance · duration — muted secondary
      var milesSpan = document.createElement('span');
      milesSpan.className = 'ext-seg-dist';
      milesSpan.textContent = segment.duration
        ? segment.miles + ' · ' + segment.duration
        : segment.miles;

      // Action text (Drop/Live/Preloaded) — plain text; always emit span for grid
      var loadTypeSpan = document.createElement('span');
      loadTypeSpan.className = 'ext-seg-action';
      loadTypeSpan.textContent = segment.loadType || '';

      // Status text — plain text with subtle color; no pill/chip
      var loadedSpan = document.createElement('span');
      loadedSpan.className = 'ext-seg-status ' + (segment.loaded ? 'ext-seg-loaded' : 'ext-seg-empty');
      loadedSpan.textContent = segment.loaded ? 'Loaded' : 'Empty';

      var arrowSpan = document.createElement('span');
      arrowSpan.className  = 'ext-seg-arrow';
      arrowSpan.textContent = '⌄';

      segHeader.appendChild(titleSpan);
      segHeader.appendChild(fromToSpan);
      segHeader.appendChild(milesSpan);
      segHeader.appendChild(loadTypeSpan);
      segHeader.appendChild(loadedSpan);
      segHeader.appendChild(arrowSpan);

      var segBody = document.createElement('div');
      segBody.className = 'ext-seg-body'; // no ext-open — collapsed by default
      segBody.appendChild(buildSegmentTable(segment));

      // Toggle collapse — closure captures this header + body pair
      (function (hdr, body) {
        hdr.addEventListener('click', function () {
          hdr.classList.toggle('ext-open');
          body.classList.toggle('ext-open');
        });
      }(segHeader, segBody));

      panel.appendChild(segHeader);
      panel.appendChild(segBody);

    } else {
      // Single segment — table always visible, no accordion wrapper
      var wrapper = document.createElement('div');
      wrapper.appendChild(buildSegmentTable(segment));
      panel.appendChild(wrapper);
    }
  });

  panel.appendChild(buildActionBar());

  return panel;
}

// Resolves the live outermost card element for loadId at click time.
// Mirrors parseLoads() dedup: initManualToggle.closest() returns the INNERMOST matching
// ancestor, but parseLoads keeps only the OUTERMOST via allCards.filter(elB.contains(elA)).
// When Amazon nests div.wo-card-header--highlighted inside div.load-card, the captured
// cardElement is the inner node — it has div[id] but lacks .equipment-type-text /
// .wo-total_payout / .wo-card-header__components, so parseOneCard returns empty Phase 1.
// Selectors: div.load-card, div.load-card__selected — same pair as parseLoads querySelectorAll.
// div.wo-card-header--highlighted excluded: always an inner wrapper, never the outer container;
// parseLoads already drops it via the contains() filter.
function findLiveOutermostCard(loadId) {
  var idEl = document.getElementById(loadId);
  if (!idEl) return null;
  var card = idEl.closest('div.load-card, div.load-card__selected');
  if (!card) return null;
  var outer = card;
  var p = card.parentElement;
  while (p) {
    var candidate = p.closest('div.load-card, div.load-card__selected');
    if (!candidate) break;
    outer = candidate;
    p = candidate.parentElement;
  }
  return outer;
}

function showInlinePanel(cardElement) {
  logger.log('inlinePanel', 'showInlinePanel called');

  injectPanelStyle();

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  var data = readSheetData();
  if (!data || !data.segments || data.segments.length === 0) {
    logger.warn('inlinePanel', 'no sheet data to render');
    return false;
  }

  // Phase 2 merge — store the detail struct under this load's loadId.
  // readSheetData() does not know the loadId; resolve it the same way parseOneCard() does.
  var sheetLoadIdEl = cardElement.querySelector('div[id]');
  var sheetLoadId   = sheetLoadIdEl ? sheetLoadIdEl.id : null;
  if (sheetLoadId) {
    loadStore.mergeLoadUnit(sheetLoadId, { detail: data });
  }

  var panel = buildPanelElement(data);
  panel.id  = PANEL_ID;

  // Wire ext-action-camera: click → screenshot this card → copy PNG to clipboard.
  // Handler attached here because cardElement is only available in showInlinePanel().
  // This is our own extension UI element, not Amazon DOM — exempt from the 3-click-site rule.
  var cameraBtn = panel.querySelector('[data-testid="ext-action-camera"]');
  if (cameraBtn) {
    cameraBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-camera clicked');
      captureCardToClipboard(cardElement, cameraBtn);
    });
  }

  var mapBtn = panel.querySelector('[data-testid="ext-action-map"]');
  if (mapBtn) {
    mapBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-map clicked');
      openRouteInMaps(data);
    });
  }

  var postBtn = panel.querySelector('[data-testid="ext-action-post"]');
  if (postBtn) {
    postBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-post clicked');
      // On-demand Phase 1 parse: covers the case where the refresh loop was never started
      // and parseLoads() has therefore never run for this card.
      // parseOneCard() is standalone-safe — no effect on knownLoadIds, detection pipeline,
      // tabState, highlight, or sound. Replicates exactly the mergeLoadUnit call in parseLoads().
      try {
        var storedUnit  = sheetLoadId ? loadStore.getLoadUnit(sheetLoadId) : null;
        var needsPhase1 = !storedUnit || !storedUnit.equipment ||
                          !storedUnit.boardStops || storedUnit.boardStops.length === 0;
        if (needsPhase1 && sheetLoadId) {
          var liveCard    = findLiveOutermostCard(sheetLoadId);
          var usedLive    = !!liveCard;
          var sameNode    = liveCard === cardElement;
          var parseTarget = liveCard || cardElement;
          logger.log('inlinePanel', 'ext-action-post: Phase 1 missing — parsing card on demand', { loadId: sheetLoadId, usedLive: usedLive, sameNode: sameNode });
          var parsed = parseOneCard(parseTarget);
          loadStore.mergeLoadUnit(parsed.loadId || sheetLoadId, {
            payout:          parsed.payout,
            pricePerMile:    parsed.pricePerMile,
            distance:        parsed.distance,
            duration:        parsed.duration,
            boardStops:      parsed.stops,
            equipment:       parsed.equipment,
            trailerLetter:   parsed.trailerLetter,
            loadingType:     parsed.loadingType,
            deadhead:        parsed.deadhead,
            tag:             parsed.tag,
            specialServices: parsed.specialServices,
          });
          if (!parsed.equipment || !parsed.stops || parsed.stops.length === 0) {
            logger.error('inlinePanel', 'ext-action-post: on-demand parse yielded empty Phase 1 — card layout may have changed', {
              loadId:       sheetLoadId,
              outerHTMLLen: parseTarget ? parseTarget.outerHTML.length : 0,
              equipment:    parsed.equipment,
              stopsCount:   parsed.stops ? parsed.stops.length : 0,
              usedLive:     usedLive,
              sameNode:     sameNode,
            });
          }
        }
      } catch (e) {
        logger.error('inlinePanel', 'ext-action-post: on-demand Phase 1 parse failed', { error: e, loadId: sheetLoadId });
      }
      openPostModal(sheetLoadId);
    });
  }

  // Wire ext-action-fastbook: read storage for initial visibility, attach click handler,
  // and keep visibility in sync with popup toggle changes via chrome.storage.onChanged.
  if (_fastBookStorageListener) {
    chrome.storage.onChanged.removeListener(_fastBookStorageListener);
    _fastBookStorageListener = null;
  }

  var fastBookBtn = panel.querySelector('[data-testid="ext-action-fastbook"]');
  if (fastBookBtn) {
    chrome.storage.local.get('fastBookEnabled', function (data) {
      fastBookBtn.style.display = data.fastBookEnabled === true ? '' : 'none';
    });

    fastBookBtn.addEventListener('click', function () {
      logger.log('inlinePanel', 'ext-action-fastbook clicked', { loadId: sheetLoadId });
      executeFastBook(sheetLoadId, fastBookBtn);
    });

    _fastBookStorageListener = function (changes, area) {
      if (area !== 'local' || changes.fastBookEnabled === undefined) return;
      fastBookBtn.style.display = changes.fastBookEnabled.newValue === true ? '' : 'none';
      if (changes.fastBookEnabled.newValue !== true) {
        fastBookBtn.disabled = false;
        fastBookBtn.textContent = 'Fast Book';
      }
    };
    chrome.storage.onChanged.addListener(_fastBookStorageListener);
  }

  cardElement.parentNode.insertBefore(panel, cardElement.nextSibling);

  // Update currentPanelCard here so both auto-open and manual paths stay in sync.
  // Ownership is here (set) and in removeInlinePanel (clear); initManualToggle no longer touches it.
  currentPanelCard = cardElement;

  logger.log('inlinePanel', 'panel rendered', { segments: data.segments.length });
  return true;
}

function removeInlinePanel() {
  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();
  currentPanelCard = null;
  if (_fastBookStorageListener) {
    chrome.storage.onChanged.removeListener(_fastBookStorageListener);
    _fastBookStorageListener = null;
  }
}

function initManualToggle() {
  if (window.__extManualToggleInit) return;
  window.__extManualToggleInit = true;

  document.addEventListener('click', function (ev) {
    var card = ev.target.closest('div.load-card, div.load-card__selected');
    if (!card) return;

    // Login gate (2026-07-20): this listener is registered once and never removed
    // (window.__extManualToggleInit guard above), so it must gate itself on every click
    // rather than relying on being un-registered on logout. isAuthGateActiveSync() reads
    // utils/authGate.js's last-known state synchronously — kept in sync live by
    // onAuthGateChange, not just at page load.
    if (typeof isAuthGateActiveSync === 'function' && !isAuthGateActiveSync()) return;

    // SAFETY: never react to clicks on forbidden elements (Book buttons etc.)
    if (isForbiddenElement(ev.target)) return;

    // Toggle off: clicking the same card while its panel is open removes it.
    // Works for both manually-opened and auto-opened panels (currentPanelCard is now
    // set by showInlinePanel, not just by this handler).
    if (currentPanelCard === card && document.getElementById(PANEL_ID)) {
      removeInlinePanel();
      return;
    }

    // Toggle on: capture a fingerprint of the currently open sheet BEFORE polling starts.
    // waitForSheet will only fire the callback once the sheet has changed (i.e., Amazon has
    // replaced the previous card's sheet with the new one), preventing stale-sheet renders.
    var prevSheet       = document.querySelector(SHEET_SELECTOR);
    var prevFingerprint = prevSheet ? sheetFingerprint(prevSheet) : null;

    waitForSheet(function () {
      try {
        tabState.set('running', false);
        logger.log('inlinePanel', 'manual card open — stopping loop for dispatcher review');
      } catch (e) {
        logger.error('inlinePanel', 'tabState stop failed on manual card open', { error: e });
      }
      try {
        showInlinePanel(card);
        // currentPanelCard ownership has moved to showInlinePanel — no assignment here
      } catch (e) {
        logger.warn('inlinePanel', 'manual toggle render failed', { error: e });
      }
    }, prevFingerprint);
  });

  logger.log('inlinePanel', 'manual toggle initialized');
}

// Expose for manual console testing only — NOT called automatically.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.showPanel        = function () {
  var c = document.querySelector('div.load-card__selected, div.load-card');
  return showInlinePanel(c);
};
window.__EXT_DEBUG.removePanel      = removeInlinePanel;
window.__EXT_DEBUG.initManualToggle = initManualToggle;
