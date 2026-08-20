// PAT (Post-a-Truck) network layer — same-origin, no new permissions.
// CSRF always read live from <meta name="x-owp-csrf-token">.
// No .click() on any Amazon DOM element. No innerHTML with page data.

// Confirmed endpoint from live cURL capture of a real Post-a-Truck submission.
var PAT_UPSERT_PATH  = '/api/loadboard/orders/upsert';
var CITY_SEARCH_BASE = '/api/loadboard/filters/cities/search/';

// Equipment types for 53' Trailer — confirmed from live upsert capture.
var PAT_EQUIPMENT_TYPES_53 = [
  'FIFTY_THREE_FOOT_TRUCK',
  'SKIRTED_FIFTY_THREE_FOOT_TRUCK',
  'FIFTY_THREE_FOOT_DRY_VAN',
  'FIFTY_THREE_FOOT_A5_AIR_TRAILER',
  'FORTY_FIVE_FOOT_TRUCK',
];

// Equipment types for 53' Container and Chassis — confirmed from live upsert capture 2026-07-14.
// Payload structure identical to 53' Trailer; only this list differs.
var PAT_EQUIPMENT_TYPES_CONTAINER = [
  'FIFTY_THREE_FOOT_CONTAINER',
];

// Equipment types for 40' Container — confirmed from Amazon API data 2026-07-14.
var PAT_EQUIPMENT_TYPES_40_CONTAINER = [
  'FORTY_FOOT_CONTAINER',
];

// DRIVER TYPES for the upsert (2026-08-19).
//
// SOLO is the only value ever captured: api-samples.md 3 records "driverTypes": ["SOLO"] from a
// live upsert, and it is what this file has always sent.
var PAT_DRIVER_TYPES_SOLO = ['SOLO'];

// TEAM — CONFIRMED 2026-08-19 from a real captured upsert
// (samples/pat-upsert-team-26ft-carrier-owned.json, api-samples.md 7): driverTypes: ["TEAM"].
//
// It was deliberately left undefined until this capture existed, because the load-board's own
// vocabulary is NOT the upsert's — the board says transitOperatorType "TEAM_DRIVER", a different
// field on a different API, and one cannot be derived from the other. The capture supplied the
// upsert token directly, so nothing is inferred.
var PAT_DRIVER_TYPES_TEAM = ['TEAM'];

// TRAILER OWNERSHIP. Both values are backed by a real captured upsert body.
//   AMAZON_PROVIDED — api-samples.md 3, the 53' Trailer capture (2026-07-14)
//   CARRIER_OWNED   — samples/pat-upsert-team-26ft-carrier-owned.json (2026-08-19), the value the
//                     form sends for a carrier-owned (R) trailer
// Each is paired with visibleProvidedTrailerType carrying the SAME value.
//
// ⚠ Knowing both values is NOT enough to switch between them: nothing in the work-opportunity
// record identifies trailer ownership. See BACKLOG 0n.
var PAT_TRAILER_AMAZON_PROVIDED = 'AMAZON_PROVIDED';
var PAT_TRAILER_CARRIER_OWNED   = 'CARRIER_OWNED';

// Equipment types for 26' Truck — confirmed from Amazon API data 2026-07-14.
var PAT_EQUIPMENT_TYPES_26_TRUCK = [
  'TWENTY_SIX_FOOT_BOX_TRUCK',
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

// Strip currency symbols, thousands-commas, and trailing units before parseFloat.
// "1,233.2 mi" → 1233.2   "$2,279.86" → 2279.86   undefined → 0
function parseNumStr(str) {
  return parseFloat(String(str || '').replace(/[$,]/g, '')) || 0;
}

// Pre-sorted longest-first so multi-word names ("north carolina") match before "north".
var STATE_NAMES_SORTED = Object.keys(STATE_NAME_TO_CODE).sort(function (a, b) { return b.length - a.length; });

// Regex + replacement pairs for dotted-abbreviation expansion in resolvePATCity retry.
var ABBREV_EXPAND = [
  [/\bMT\./gi, 'MOUNT'],
  [/\bST\./gi, 'SAINT'],
  [/\bFT\./gi, 'FORT'],
];

// Parse { city, state } from a detail-panel stop address string.
// The address field in detail stops is the clean text shown in the pick-up/drop-off panel
// (e.g. "Concord, NC 28025" or "1000 Amazon Way, Concord, NC 28025") — no warehouse code,
// no state-code prefix — and is the authoritative source for PAT city resolution.
// Returns { city: '', state: '' } when no "CITY, 2-letter-state" pattern is found.
function parseDetailAddress(address) {
  // PII (2026-07-30): both log calls in this function used to emit the raw `address`, i.e.
  // a full street address. Never log the value — not the string, not a fragment, not the
  // parsed city or postcode — at any DEBUG_LEVEL. What is kept is enough to debug a parse
  // failure: that the step ran, whether there was any input, its length, and (below)
  // whether a pattern matched.
  logger.log('patApi', 'parseDetailAddress called', {
    hasInput: !!address, inputLength: address ? String(address).length : 0
  });
  if (!address) return { city: '', state: '' };
  var m;
  // "..., CITY, ST [ZIP]" — when a street address precedes the city (joined by ", ")
  m = address.match(/,\s*([A-Za-z][A-Za-z\s.'-]*),\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  // "CITY, ST [ZIP]" — city is the first (or only) component
  m = address.match(/^([A-Za-z][A-Za-z\s.'-]*),\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  // PII: was `{ address: address }`. Same rule as the entry log above — the failure is
  // reported, the value is not. inputLength is the one thing that actually helps here
  // (an empty-ish string vs a long one that simply lacks a "CITY, ST" pattern).
  logger.warn('patApi', 'parseDetailAddress: no match — address not in "CITY, ST [ZIP]" form', {
    matched: false, inputLength: String(address).length
  });
  return { city: '', state: '' };
}

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
  // PII (2026-07-30): was `{ str: str }` — the raw board stop (station code + CITY, ST ZIP).
  // Not in the task list but the identical leak class, so removed here too.
  logger.log('patApi', 'parseBoardStop called', { hasInput: !!str, inputLength: str ? String(str).length : 0 });
  if (!str) return { city: '', state: '' };
  // Drop leading station code ("DNA4 ", "XRD4 ", "LIT2 " — 3-5 alphanum + space)
  var afterCode = str.replace(/^\S+\s+/, '');
  var ci = afterCode.indexOf(',');
  if (ci === -1) return { city: afterCode.trim(), state: '' };
  var city = afterCode.slice(0, ci).trim();
  // Strip trailing ZIP before normalizing state (full name or 2-letter both handled)
  var stateRaw = afterCode.slice(ci + 1).trim().replace(/\s+\d{5}(-\d{4})?\s*$/, '').trim();
  // Strip full state name prefix from city: "Illinois AURORA" → "AURORA"
  var lcCity = city.toLowerCase();
  for (var sni = 0; sni < STATE_NAMES_SORTED.length; sni++) {
    if (lcCity.indexOf(STATE_NAMES_SORTED[sni] + ' ') === 0) {
      city = city.slice(STATE_NAMES_SORTED[sni].length + 1).trim();
      break;
    }
  }
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

// Returns true if every character of abbrev appears in full in the same order (subsequence check).
// Both strings must already be uppercased and contain only letters — caller strips non-letters.
function isSubseq(abbrev, full) {
  var ai = 0;
  for (var fi = 0; fi < full.length && ai < abbrev.length; fi++) {
    if (abbrev[ai] === full[fi]) ai++;
  }
  return ai === abbrev.length;
}

// Resolve a city for the PAT payload.
// input: either a raw board-stop string ("DNA4 MEMPHIS, TN 38128") parsed via parseBoardStop,
//        OR a pre-parsed { city, state } object from parseDetailAddress (preferred — clean names).
// Returns null on network error or no match.
// Confirmed response shape: array of { name, stateCode, country, latitude, longitude,
//   nearestDomicileCode, displayValue: null }  (displayValue is ALWAYS null in this API)
async function resolvePATCity(input) {
  var parsed;
  if (input && typeof input === 'object' && input.city !== undefined) {
    parsed = { city: String(input.city || ''), state: String(input.state || '') };
    // PII (2026-07-30): was the whole `parsed` object ({ city, state }).
    logger.log('patApi', 'resolvePATCity called (pre-parsed)', {
      cityLength: parsed.city.length, hasState: !!parsed.state
    });
  } else {
    // PII (2026-07-30): was `{ input: input }` — the raw board stop string.
    logger.log('patApi', 'resolvePATCity called (board string)', {
      inputLength: String(input || '').length
    });
    parsed = parseBoardStop(String(input || ''));
  }
  var city   = parsed.city;
  var state  = parsed.state;
  try {
    if (!city) {
      // PII (2026-07-30): was `{ input: input }`.
      logger.error('patApi', 'resolvePATCity: empty city from parseBoardStop', {
        inputType: (input && typeof input === 'object') ? 'object' : typeof input,
        inputLength: (typeof input === 'string') ? input.length : null
      });
      return null;
    }
    var csrf = getCsrfToken();
    var resp = await fetch(CITY_SEARCH_BASE + encodeURIComponent(city), {
      method: 'GET', credentials: 'include',
      headers: { 'Accept': 'application/json', 'x-owp-csrf-token': csrf },
    });
    if (!resp.ok) {
      // PII (2026-07-30): city removed — status is the real diagnostic here.
      logger.warn('patApi', 'resolvePATCity: non-OK', { status: resp.status, cityLength: city.length });
      return null;
    }
    var results = await resp.json();
    if (!Array.isArray(results)) {
      // PII (2026-07-30): city removed.
      logger.warn('patApi', 'resolvePATCity: non-array response', { cityLength: city.length });
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
      // Retry with dotted-abbreviation expansion (MT.→MOUNT, ST.→SAINT, FT.→FORT)
      var expandedCity = city;
      for (var ai = 0; ai < ABBREV_EXPAND.length; ai++) {
        expandedCity = expandedCity.replace(ABBREV_EXPAND[ai][0], ABBREV_EXPAND[ai][1]);
      }
      if (expandedCity !== city) {
        // PII (2026-07-30): city names removed. The lengths still show that expansion changed
        // something (e.g. "MT." -> "MOUNT" lengthens), which is what this log is for.
        logger.log('patApi', 'resolvePATCity: retrying with expanded abbrev', {
          fromLength: city.length, toLength: expandedCity.length
        });
        var resp2 = await fetch(CITY_SEARCH_BASE + encodeURIComponent(expandedCity), {
          method: 'GET', credentials: 'include',
          headers: { 'Accept': 'application/json', 'x-owp-csrf-token': csrf },
        });
        if (resp2.ok) {
          var results2 = await resp2.json();
          if (Array.isArray(results2)) {
            var lc2 = expandedCity.toLowerCase();
            for (var ei = 0; ei < results2.length; ei++) {
              if (results2[ei].name && results2[ei].name.toLowerCase() === lc2 &&
                  results2[ei].stateCode === state) { match = results2[ei]; break; }
            }
            if (!match) {
              for (var fi = 0; fi < results2.length; fi++) {
                if (results2[fi].stateCode === state && results2[fi].name &&
                    results2[fi].name.toLowerCase().indexOf(lc2) === 0) { match = results2[fi]; break; }
              }
            }
          }
        }
      }
      if (!match) {
        // Fallback: prefix query + letter-subsequence for board-abbreviated city names.
        // "BURLNGTN TWP, NJ" → prefix "BURL" → API returns all NJ cities starting with BURL
        // → subseq check ("BURLNGTNTWP" ⊆ "BURLINGTONTWP") → exactly one match → use it.
        // Never guesses when zero or more than one candidate survives.
        var abbrevLetters = city.replace(/[^A-Za-z]/g, '').toUpperCase();
        var prefix = city.slice(0, 4);
        if (abbrevLetters.length >= 4 && prefix.trim().length >= 3) {
          // PII (2026-07-30): city/prefix/state removed (prefix is a literal city fragment).
          logger.log('patApi', 'resolvePATCity: trying prefix+subsequence fallback', {
            cityLength: city.length, prefixLength: prefix.trim().length, hasState: !!state,
          });
          var resp3 = await fetch(CITY_SEARCH_BASE + encodeURIComponent(prefix), {
            method: 'GET', credentials: 'include',
            headers: { 'Accept': 'application/json', 'x-owp-csrf-token': csrf },
          });
          if (resp3.ok) {
            var results3 = await resp3.json();
            if (Array.isArray(results3)) {
              var candidates = [];
              for (var gi = 0; gi < results3.length; gi++) {
                if (results3[gi].stateCode !== state || !results3[gi].name) continue;
                var candLetters = results3[gi].name.replace(/[^A-Za-z]/g, '').toUpperCase();
                if (isSubseq(abbrevLetters, candLetters)) candidates.push(results3[gi]);
              }
              if (candidates.length === 1) {
                match = candidates[0];
                // PII (2026-07-30): city and the matched city NAME removed.
                logger.log('patApi', 'resolvePATCity: prefix+subsequence matched', {
                  cityLength: city.length, matchedLength: match.name.length, hasState: !!state,
                });
              } else if (candidates.length > 1) {
                // PII (2026-07-30): this emitted a LIST of candidate city names — the widest
                // location leak in this file. The count is what the message is actually about.
                logger.warn('patApi', 'resolvePATCity: ambiguous prefix+subsequence — not guessing', {
                  cityLength: city.length, count: candidates.length,
                });
              }
            }
          }
        }
        if (!match) {
          // PII (2026-07-30): city/state removed; n (result count) is the diagnostic.
          logger.warn('patApi', 'resolvePATCity: no match on any path', {
            cityLength: city.length, hasState: !!state, n: results.length,
          });
          return null;
        }
      }
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
    // PII (2026-07-30): city/state removed; the error object is the diagnostic.
    logger.error('patApi', 'resolvePATCity failed', { error: e, cityLength: city ? city.length : 0, hasState: !!state });
    return null;
  }
}

// resolveLoadingType() WAS REMOVED 2026-08-19 (F3).
//
// It mapped the board's label ("Drop" / "Live" / "Live/Drop") to the posted loadingTypeList, and
// returned null for anything else — which is why a load labelled "LTL/Live/Drop" could not be
// posted at all. The posted value is now the FIXED PAT_LOADING_TYPE_LIST in patModal.js, by Ihor's
// product decision, so nothing derives it from a label any more.
//
// Deleted rather than left in place: a dead mapper next to a live payload field reads as though it
// still decides something, and the next person would wire it back in.

// Build the PAT upsert POST body — structure reconciled against live cURL capture (MEMPHIS→LEBANON).
// formState: { originCity, destCity (from resolvePATCity),
//   equipmentTypes (string[] — PAT_EQUIPMENT_TYPES_53 or PAT_EQUIPMENT_TYPES_CONTAINER),
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
    // DERIVED from the load since 2026-08-19 — see PAT_DRIVER_BY_TRANSIT_OPERATOR. This was a
    // hardcoded ['SOLO'] literal from the very first commit that introduced it (512381d), so a
    // team load posted silently as solo. It is a long-standing defect, NOT a regression from the
    // Stage A re-sourcing.
    driverTypes:                 formState.driverTypes,
    visibleEquipmentTypes:       formState.equipmentTypes[0],
    equipmentTypes:              formState.equipmentTypes,
    // ⚠ STILL HARDCODED TO AMAZON-PROVIDED. Both constants are capture-backed —
    // PAT_TRAILER_AMAZON_PROVIDED from api-samples.md 3, PAT_TRAILER_CARRIER_OWNED from the
    // 2026-08-19 capture — but NOTHING IN THE RECORD SAYS WHICH ONE A LOAD IS. Every trailer
    // ownership field on the work opportunity was enumerated across all 159 captures and none
    // distinguishes carrier-owned from Amazon-provided. So an R load still posts as Provided.
    // That is BACKLOG 0n and it is blocked on DETECTION, not on these values.
    // DERIVED since 2026-08-20 from the card's P/R badge letter — an INTERIM DOM DEPENDENCY,
    // the only field in this payload not sourced from the API record. See the block above
    // PAT_TRAILER_BY_LETTER in patModal.js for why it exists and when to delete it.
    // Both keys always carry the SAME value (api-samples.md 8a, eleven captures).
    visibleProvidedTrailerType:  formState.providedTrailerType,
    providedTrailerType:         formState.providedTrailerType,
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
  // PII (2026-07-30): was the ENTIRE payload, which embeds the resolved origin/destination
  // city objects (names included). Logged as a shape summary instead — enough to see the post
  // was assembled correctly, with no location values.
  logger.log('patApi', 'submitOrder called', {
    keys: Object.keys(payload || {}).length,
    hasOriginCity: !!(payload && payload.originCity),
    hasDestCity: !!(payload && payload.destCity),
  });
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
