// PAT (Post-a-Truck) network layer — same-origin, no new permissions.
// CSRF always read live from <meta name="x-owp-csrf-token">.
// No .click() on any Amazon DOM element. No innerHTML with page data.

// Confirmed endpoint from live cURL capture of a real Post-a-Truck submission.
var PAT_UPSERT_PATH  = '/api/loadboard/orders/upsert';
var CITY_SEARCH_BASE = '/api/loadboard/filters/cities/search/';

// Equipment types for 53' Trailer — confirmed from live upsert capture.
// For new equipment types: capture a live upsert first, then add a separate entry.
var PAT_EQUIPMENT_TYPES_53 = [
  'FIFTY_THREE_FOOT_TRUCK',
  'SKIRTED_FIFTY_THREE_FOOT_TRUCK',
  'FIFTY_THREE_FOOT_DRY_VAN',
  'FIFTY_THREE_FOOT_A5_AIR_TRAILER',
  'FORTY_FIVE_FOOT_TRUCK',
];

// All 50 US states + DC: full name (lowercase) → 2-letter code.
var STATE_NAME_TO_CODE = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR',
  'california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE',
  'district of columbia':'DC','florida':'FL','georgia':'GA','hawaii':'HI',
  'idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME',
  'maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN',
  'mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE',
  'nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
  'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH',
  'oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI',
  'south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX',
  'utah':'UT','vermont':'VT','virginia':'VA','washington':'WA',
  'west virginia':'WV','wisconsin':'WI','wyoming':'WY',
};

// US timezone abbreviations → UTC offset in hours (standard abbreviations only).
var TZ_OFFSET_HOURS = {
  EDT:-4, EST:-5, CDT:-5, CST:-6, MDT:-6, MST:-7, PDT:-7, PST:-8,
};

// Normalize a state string to 2-letter code.
// "FL" → "FL"; "Florida" → "FL"; "Indiana" → "IN"
function normalizeState(s) {
  s = (s || '').trim();
  if (s.length === 2) return s.toUpperCase();
  return STATE_NAME_TO_CODE[s.toLowerCase()] || s.toUpperCase().slice(0, 2);
}

// Parse a boardStops entry into { city, state } (2-letter code).
// Handles all observed formats:
//   "DNA4 MEMPHIS, TN 38128-2510"            → { city:"MEMPHIS",          state:"TN" }
//   "XRD4 GREENSBORO, North Carolina 27409"  → { city:"GREENSBORO",       state:"NC" }
//   "LIT2 NORTH LITTLE ROCK, AR 72117-5026" → { city:"NORTH LITTLE ROCK", state:"AR" }
function parseBoardStop(str) {
  logger.log('patApi', 'parseBoardStop called', { str: str });
  if (!str) return { city: '', state: '' };
  // Drop leading station code ("DNA4 ", "XRD4 ", "LIT2 " — 3-5 alphanum + space)
  var afterCode = str.replace(/^\S+\s+/, '');
  var ci = afterCode.indexOf(',');
  if (ci === -1) return { city: afterCode.trim(), state: '' };
  var city = afterCode.slice(0, ci).trim();
  // Strip trailing ZIP ("38128-2510", "27409") before normalizing state.
  // State may be 2-letter ("TN") or full name ("North Carolina") — both handled
  // by normalizeState via STATE_NAME_TO_CODE.
  var stateRaw = afterCode.slice(ci + 1).trim().replace(/\s+\d{5}(-\d{4})?\s*$/, '').trim();
  return { city: city, state: normalizeState(stateRaw) };
}

// Parse "07/10 10:42 EDT" → { date: Date(UTC), tzName, tzOffset }
// Returns { tzError: tzName } if the TZ abbreviation is unrecognized.
// Returns null if the format is unrecognized.
function parsePatStopTime(timeStr) {
  logger.log('patApi', 'parsePatStopTime called', { timeStr: timeStr });
  if (!timeStr) return null;
  var m = timeStr.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s+([A-Z]{2,5}))?/);
  if (!m) return null;
  var month  = parseInt(m[1], 10);
  var day    = parseInt(m[2], 10);
  var hour   = parseInt(m[3], 10);
  var minute = parseInt(m[4], 10);
  var tzName = m[5] || '';
  if (tzName && !(tzName in TZ_OFFSET_HOURS)) return { tzError: tzName };
  var offset = tzName ? TZ_OFFSET_HOURS[tzName] : 0;
  var year   = new Date().getFullYear();
  // Local time in named TZ is UTC + offset, so UTC = local values − offset
  var utcMs  = Date.UTC(year, month - 1, day, hour, minute) - offset * 3600000;
  var cand   = new Date(utcMs);
  // If more than 30 days in the past, roll to next year
  if (Date.now() - cand.getTime() > 30 * 24 * 3600000) {
    utcMs = Date.UTC(year + 1, month - 1, day, hour, minute) - offset * 3600000;
    cand  = new Date(utcMs);
  }
  return { date: cand, tzName: tzName, tzOffset: offset };
}

function getCsrfToken() {
  logger.log('patApi', 'getCsrfToken called');
  var meta = document.querySelector('meta[name="x-owp-csrf-token"]');
  if (!meta) { logger.warn('patApi', 'getCsrfToken: meta tag not found'); return ''; }
  return meta.getAttribute('content') || '';
}

// Resolve a boardStops string to a full city object for the PAT payload.
// Returns null on network error or no match.
// Confirmed response shape: array of { name, stateCode, country, latitude, longitude,
//   nearestDomicileCode, displayValue: null }  (displayValue is ALWAYS null in this API)
async function resolvePATCity(boardStopStr) {
  logger.log('patApi', 'resolvePATCity called', { boardStopStr: boardStopStr });
  var parsed = parseBoardStop(boardStopStr);
  var city   = parsed.city;
  var state  = parsed.state;
  if (!city) {
    logger.error('patApi', 'resolvePATCity: empty city from parseBoardStop', { boardStopStr: boardStopStr });
    return null;
  }
  try {
    var csrf = getCsrfToken();
    var resp = await fetch(CITY_SEARCH_BASE + encodeURIComponent(city), {
      method: 'GET', credentials: 'include',
      headers: { 'Accept': 'application/json', 'x-owp-csrf-token': csrf },
    });
    if (!resp.ok) {
      logger.warn('patApi', 'resolvePATCity: non-OK', { status: resp.status, city: city });
      return null;
    }
    var results = await resp.json();
    if (!Array.isArray(results)) {
      logger.warn('patApi', 'resolvePATCity: non-array response', { city: city });
      return null;
    }
    var lc    = city.toLowerCase();
    var match = null;
    // Primary: exact name (case-insensitive) AND stateCode
    for (var i = 0; i < results.length; i++) {
      if (results[i].name && results[i].name.toLowerCase() === lc &&
          results[i].stateCode === state) { match = results[i]; break; }
    }
    // Fallback: stateCode matches AND name starts with city
    if (!match) {
      for (var j = 0; j < results.length; j++) {
        if (results[j].stateCode === state && results[j].name &&
            results[j].name.toLowerCase().indexOf(lc) === 0) { match = results[j]; break; }
      }
    }
    if (!match) {
      logger.warn('patApi', 'resolvePATCity: no match', { city: city, state: state, n: results.length });
      return null;
    }
    var displayValue = match.name + ', ' + match.stateCode;
    return {
      name:                match.name,
      stateCode:           match.stateCode,
      country:             match.country || null,
      latitude:            match.latitude,
      longitude:           match.longitude,
      displayValue:        displayValue,
      nearestDomicileCode: null,
      uniqueKey:           String(match.latitude) + displayValue,
      isCityLive:          false,
      isAnywhere:          false,
    };
  } catch (e) {
    logger.error('patApi', 'resolvePATCity failed', { error: e, city: city, state: state });
    return null;
  }
}

// Map loadingType string → loadingTypeList array.
// Returns null for unrecognized values — caller must surface error.
// Combined case is order-insensitive: "Live/Drop" and "Drop/Live" both confirmed on the live board.
// Output order is always ["LIVE","DROP"] to match the captured upsert payload.
function resolveLoadingType(str) {
  logger.log('patApi', 'resolveLoadingType called', { str: str });
  if (str === 'Drop') return ['DROP'];
  if (str === 'Live') return ['LIVE'];
  var tokens = str.split('/').map(function (t) { return t.trim(); });
  var hasLive = false;
  var hasDrop = false;
  for (var i = 0; i < tokens.length; i++) {
    if      (tokens[i] === 'Live') { hasLive = true; }
    else if (tokens[i] === 'Drop') { hasDrop = true; }
    else { return null; }
  }
  if (hasLive && hasDrop) return ['LIVE', 'DROP'];
  return null;
}

// Build the PAT upsert POST body — structure reconciled against live cURL capture (MEMPHIS→LEBANON).
// formState: { originCity, destCity (from resolvePATCity),
//   originRadius, destRadius (numbers), startTime, endTime (Date UTC),
//   stopCount, minMiles, maxMiles, permile, payout, stemMin (numbers),
//   loadingTypeList (string[]), excludeSpecialServices (string[]) }
function buildPatPayload(formState) {
  logger.log('patApi', 'buildPatPayload called');
  var o = formState.originCity;
  var d = formState.destCity;
  return {
    runType:                     'ONE_WAY',
    distanceOrDuration:          'DISTANCE',
    payoutType:                  'FLAT_RATE',
    totalCost:                   { value: formState.payout,      unit: 'USD' },
    costPerDistance:             { value: formState.permile, currencyUnit: 'USD', distanceUnit: 'mi' },
    minDistance:                 { value: formState.minMiles,     unit: 'mi' },
    maxDistance:                 { value: formState.maxMiles,     unit: 'mi' },
    originCityRadius:            { value: formState.originRadius, unit: 'mi' },
    destinationCityRadius:       { value: formState.destRadius,   unit: 'mi' },
    startTime:                   formState.startTime.toISOString(),
    endTime:                     formState.endTime.toISOString(),
    startTimeWindow:             null,
    maxNumberOfStops:            formState.stopCount,
    minPickUpBufferInMinutes:    formState.stemMin,
    minDurationInMinutes:        null,
    maxDurationInMinutes:        null,
    loadingTypeList:             formState.loadingTypeList,
    excludeSpecialServices:      formState.excludeSpecialServices,
    driverTypes:                 ['SOLO'],
    visibleEquipmentTypes:       PAT_EQUIPMENT_TYPES_53[0],
    equipmentTypes:              PAT_EQUIPMENT_TYPES_53,
    visibleProvidedTrailerType:  'AMAZON_PROVIDED',
    providedTrailerType:         'AMAZON_PROVIDED',
    originCityInfo:              {
      name:                o.name,
      stateCode:           o.stateCode,
      country:             o.country,
      latitude:            o.latitude,
      longitude:           o.longitude,
      displayValue:        o.displayValue,
      nearestDomicileCode: o.nearestDomicileCode,
      isCityLive:          false,
      isAnywhere:          false,
      uniqueKey:           o.uniqueKey,
    },
    endLocationList:             [{
      displayValue:        d.displayValue,
      stateCode:           d.stateCode,
      isCityLive:          false,
      latitude:            d.latitude,
      longitude:           d.longitude,
      name:                d.name,
      nearestDomicileCode: d.nearestDomicileCode,
    }],
    endRegionList:               [],
    isLinkedOrder:               false,
    isRepostingAllowed:          true,
    isAnywhereDestination:       false,
    matchingDemands:             [],
    matchingWork:                0,
    isCheckingMatchingWork:      false,
    isMatchingWorkLoaded:        false,
    supplyDriverIdList:          [],
    supplyTransientDriverIdList: [],
    exclusionCityList:           [],
    destinationCityInfo:         null,
    destinationCityInfoForFilter: null,
    auditMetaData:               { suggestedCostPerDistance: null, matchOutlookScore: 'LOW' },
    patOrderContext:              null,
    cancellationDetails:          null,
    repostingDetails:             null,
  };
}

// POST the PAT payload. Returns { ok, status[, body] }.
async function submitOrder(payload) {
  logger.log('patApi', 'submitOrder called', { payload: payload });
  try {
    var csrf = getCsrfToken();
    if (!csrf) {
      logger.error('patApi', 'submitOrder: no CSRF token');
      return { ok: false, status: 0, body: 'No CSRF token' };
    }
    var resp = await fetch(PAT_UPSERT_PATH, {
      method: 'POST', credentials: 'include',
      headers: {
        'Content-Type': 'application/json', 'Accept': '*/*',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(payload),
    });
    var body = '';
    try { body = await resp.text(); } catch (_) {}
    if (!resp.ok) {
      logger.error('patApi', 'submitOrder: non-OK', { status: resp.status, body: body });
      return { ok: false, status: resp.status, body: body };
    }
    logger.log('patApi', 'submitOrder: success', { status: resp.status });
    return { ok: true, status: resp.status };
  } catch (e) {
    logger.error('patApi', 'submitOrder failed', { error: e });
    return { ok: false, status: 0, body: String(e) };
  }
}
