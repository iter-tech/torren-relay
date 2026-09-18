// PAT Bridge — the RELAY-TAB half of the website bridge.
//
// 🔑 THIS IS THE ONLY PLACE A WEBSITE-ORIGINATED POST IS ACTUALLY SENT, and it sends it through
// the EXISTING submitOrder() in patApi.js. There is no second posting implementation: a duplicate
// would drift from the one the modal uses, and the two would disagree about what a post is.
//
// ── WHY THE FETCH MUST HAPPEN HERE ────────────────────────────────────────────────────────
// submitOrder() POSTs same-origin to PAT_UPSERT_PATH with `credentials: 'include'` and the CSRF
// token read live from `<meta name="x-owp-csrf-token">`. Both the cookie and that meta tag exist
// only on an authenticated Relay page, so the call is only possible from a content script in that
// tab. The service worker cannot do it and the website certainly cannot.
//
// ── THE MESSAGE FROM THE WEBSITE IS UNTRUSTED ─────────────────────────────────────────────
// ⚠ EVERYTHING ARRIVING FROM THE PAGE IS VALIDATED BEFORE IT REACHES submitOrder(), against the
// same rules patModal.js enforces at its own submit. A truck post is an outward commitment to a
// live marketplace; "the site built it, so it must be fine" is not a security model.
//
// ⚠ AND THE TOP-LEVEL KEY SET IS AN ALLOW-LIST, not a sanity check. Without it a page could add
// fields Amazon happens to honour — the shape would still pass every value check and the post
// would carry something nobody reviewed.
//
// 🔴 WHAT VALIDATION CANNOT DO, STATED PLAINLY: it constrains SHAPE and SANITY, not INTENT. A
// well-formed post from a script the dispatcher did not drive still passes. See DECISIONS.md D24.

var PAT_BRIDGE_PROTOCOL_VERSION = 1;

// The complete set of keys buildPatPayload() produces. Anything else is rejected outright.
var PAT_BRIDGE_ALLOWED_KEYS = [
  'runType', 'distanceOrDuration', 'payoutType', 'totalCost', 'costPerDistance',
  'minDistance', 'maxDistance', 'originCityRadius', 'destinationCityRadius',
  'startTime', 'endTime', 'startTimeWindow', 'maxNumberOfStops', 'minPickUpBufferInMinutes',
  'minDurationInMinutes', 'maxDurationInMinutes', 'loadingTypeList', 'excludeSpecialServices',
  'driverTypes', 'visibleEquipmentTypes', 'equipmentTypes', 'visibleProvidedTrailerType',
  'providedTrailerType', 'originCityInfo', 'endLocationList', 'endRegionList', 'isLinkedOrder',
  'isRepostingAllowed', 'isAnywhereDestination', 'matchingDemands', 'matchingWork',
  'isCheckingMatchingWork', 'isMatchingWorkLoaded', 'supplyDriverIdList',
  'supplyTransientDriverIdList', 'exclusionCityList', 'destinationCityInfo',
  'destinationCityInfoForFilter', 'auditMetaData', 'patOrderContext', 'cancellationDetails',
  'repostingDetails',
];

/** Is this tab an authenticated load board? Both halves matter and neither is assumed. */
function patBridgeTabStatus() {
  logger.log('patBridge', 'patBridgeTabStatus called');
  var onBoard = (typeof isLoadBoardPage === 'function') ? isLoadBoardPage() : false;
  // 🔑 THE CSRF META IS THE SIGNED-IN TEST. It is what patApi.js already requires to post, so
  // "signed in" here means exactly "a post could succeed", not a guess from the URL.
  var csrf = (typeof getCsrfToken === 'function') ? getCsrfToken() : null;
  return {
    isLoadBoard: onBoard,
    signedIn: onBoard && !!csrf,
    // ⚠ NO ACCOUNT NAME. Nothing Amazon returns to this extension names the logged-in carrier —
    // measured across all 18 captures, DECISIONS.md D22. An empty list is the honest answer and
    // the site renders "cannot be determined" for it. Do not fill this with a domicile code.
    accounts: [],
  };
}

var patBridgeNum = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : null; };

/**
 * Validates a website-built payload against patModal.js's own submit-time rules.
 * Returns an array of human-readable reasons; empty means acceptable.
 */
function patBridgeValidate(payload) {
  logger.log('patBridge', 'patBridgeValidate called');
  var errs = [];
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return ['Payload is not an object.'];
    }

    // ── the allow-list, first: an unexpected key is a hard stop ──
    var keys = Object.keys(payload);
    for (var i = 0; i < keys.length; i++) {
      if (PAT_BRIDGE_ALLOWED_KEYS.indexOf(keys[i]) === -1) {
        errs.push('Unexpected field in payload: «' + keys[i] + '»');
      }
    }

    // ── the constants this codebase always sends. A different value means a different post. ──
    if (payload.runType !== 'ONE_WAY') errs.push('runType must be ONE_WAY.');
    if (payload.distanceOrDuration !== 'DISTANCE') errs.push('distanceOrDuration must be DISTANCE.');
    if (payload.payoutType !== 'FLAT_RATE') errs.push('payoutType must be FLAT_RATE.');

    // ── money and distance: the same gates updateConfirmEnabled() applies ──
    var payout = payload.totalCost && patBridgeNum(payload.totalCost.value);
    if (payout === null || !(payout > 0)) errs.push('Payout must be a positive number.');
    var permile = payload.costPerDistance && patBridgeNum(payload.costPerDistance.value);
    if (permile === null || !(permile >= 0)) errs.push('Cost per mile must be 0 or greater.');

    var minMi = payload.minDistance && patBridgeNum(payload.minDistance.value);
    var maxMi = payload.maxDistance && patBridgeNum(payload.maxDistance.value);
    if (minMi === null || minMi < 0) errs.push('Min Miles must be 0 or greater.');
    else if (maxMi === null || maxMi < minMi) errs.push('Max Miles must be ≥ Min Miles.');

    var stops = patBridgeNum(payload.maxNumberOfStops);
    if (stops === null || stops < 1) errs.push('Stop count must be 1 or more.');

    var stem = patBridgeNum(payload.minPickUpBufferInMinutes);
    if (stem === null || stem < 0) errs.push('Stem time must be 0 or greater.');

    var oRad = payload.originCityRadius && patBridgeNum(payload.originCityRadius.value);
    var dRad = payload.destinationCityRadius && patBridgeNum(payload.destinationCityRadius.value);
    if (oRad === null || oRad <= 0) errs.push('Origin radius must be positive.');
    if (dRad === null || dRad <= 0) errs.push('Destination radius must be positive.');

    // ── times: real instants, and in order ──
    var st = payload.startTime ? new Date(payload.startTime) : null;
    var en = payload.endTime ? new Date(payload.endTime) : null;
    if (!st || isNaN(st.getTime())) errs.push('startTime is missing or unparseable.');
    if (!en || isNaN(en.getTime())) errs.push('endTime is missing or unparseable.');
    if (st && en && !isNaN(st.getTime()) && !isNaN(en.getTime()) && en.getTime() <= st.getTime()) {
      errs.push('endTime must be after startTime.');
    }

    // ── enums: only values this codebase knows. No new token passes through. ──
    if (!Array.isArray(payload.loadingTypeList) || payload.loadingTypeList.length === 0) {
      errs.push('loadingTypeList is empty.');
    } else {
      for (var l = 0; l < payload.loadingTypeList.length; l++) {
        if (['LIVE', 'DROP'].indexOf(payload.loadingTypeList[l]) === -1) {
          errs.push('Unknown loading type: «' + payload.loadingTypeList[l] + '»');
        }
      }
    }

    // ⚠ TRAILER OWNERSHIP MUST BE ONE OF THE TWO CAPTURE-BACKED CONSTANTS, and both keys must
    // agree — eleven captured upserts show them always carrying the same value.
    var trailerOk = [PAT_TRAILER_AMAZON_PROVIDED, PAT_TRAILER_CARRIER_OWNED];
    if (trailerOk.indexOf(payload.providedTrailerType) === -1) {
      errs.push('Unknown trailer type: «' + String(payload.providedTrailerType) + '»');
    }
    if (payload.visibleProvidedTrailerType !== payload.providedTrailerType) {
      errs.push('visibleProvidedTrailerType must equal providedTrailerType.');
    }

    if (!Array.isArray(payload.driverTypes) || payload.driverTypes.length === 0) {
      errs.push('driverTypes is empty.');
    } else {
      for (var dI = 0; dI < payload.driverTypes.length; dI++) {
        if (['SOLO', 'TEAM'].indexOf(payload.driverTypes[dI]) === -1) {
          errs.push('Unknown driver type: «' + payload.driverTypes[dI] + '»');
        }
      }
    }

    // Equipment must be one of the lists patApi.js defines — not an arbitrary array.
    var known = [PAT_EQUIPMENT_TYPES_53, PAT_EQUIPMENT_TYPES_CONTAINER, PAT_EQUIPMENT_TYPES_26_TRUCK];
    var matched = false;
    if (Array.isArray(payload.equipmentTypes)) {
      for (var k = 0; k < known.length; k++) {
        if (known[k].join('|') === payload.equipmentTypes.join('|')) { matched = true; break; }
      }
    }
    if (!matched) errs.push('equipmentTypes is not one of the supported equipment lists.');
    if (Array.isArray(payload.equipmentTypes) &&
        payload.visibleEquipmentTypes !== payload.equipmentTypes[0]) {
      errs.push('visibleEquipmentTypes must be the first element of equipmentTypes.');
    }

    if (Array.isArray(payload.excludeSpecialServices)) {
      for (var s = 0; s < payload.excludeSpecialServices.length; s++) {
        if (payload.excludeSpecialServices[s] !== 'SWING_DOOR') {
          errs.push('Unknown special service exclusion: «' + payload.excludeSpecialServices[s] + '»');
        }
      }
    } else {
      errs.push('excludeSpecialServices must be an array.');
    }
  } catch (e) {
    logger.error('patBridge', 'patBridgeValidate threw — rejecting rather than passing', { error: e });
    return ['Validation failed: ' + String(e)];
  }
  return errs;
}

/**
 * Resolve the two cities and post.
 *
 * 🔑 THE CITIES ARE RESOLVED HERE, NOT ON THE WEBSITE. resolvePATCity() queries Amazon's own
 * cities API with this tab's session — the exact thing the site cannot do (D2). The site sends
 * the city and state it read from the load; this turns them into the objects Amazon's upsert
 * wants. **The site's own originCityInfo/endLocationList are discarded**, not merged: accepting
 * a city object from the page would let it post to a location the dispatcher never chose.
 */
async function patBridgeSubmit(msg) {
  logger.log('patBridge', 'patBridgeSubmit called');
  try {
    var status = patBridgeTabStatus();
    if (!status.signedIn) {
      logger.warn('patBridge', 'patBridgeSubmit: tab is not an authenticated load board — refused');
      return { ok: false, refused: true, reason: status.isLoadBoard
        ? 'The Amazon Relay tab is not signed in.'
        : 'This tab is not the Amazon Relay load board.' };
    }

    var payload = msg && msg.payload;
    var errs = patBridgeValidate(payload);
    if (errs.length) {
      logger.error('patBridge', 'patBridgeSubmit: payload REJECTED', { reasons: errs });
      return { ok: false, refused: true, reason: 'Rejected: ' + errs.join(' | ') };
    }

    // ── cities ──
    var oIn = msg.origin, dIn = msg.dest;
    if (!oIn || !oIn.city || !dIn || !dIn.city) {
      return { ok: false, refused: true, reason: 'Origin/destination city missing from the request.' };
    }
    var pair;
    try {
      pair = await Promise.all([resolvePATCity(oIn), resolvePATCity(dIn)]);
    } catch (e) {
      logger.error('patBridge', 'patBridgeSubmit: city resolution threw', { error: e });
      return { ok: false, refused: true, reason: 'City lookup failed: ' + String(e) };
    }
    var originCity = pair[0], destCity = pair[1];
    if (!originCity) return { ok: false, refused: true, reason: 'Origin city could not be resolved on Amazon.' };
    if (!destCity)   return { ok: false, refused: true, reason: 'Destination city could not be resolved on Amazon.' };

    // ⚠ REBUILT, NOT PATCHED. The two city keys are written from the objects resolved HERE,
    // over whatever the page sent.
    payload.originCityInfo = {
      name: originCity.name, stateCode: originCity.stateCode, country: originCity.country,
      latitude: originCity.latitude, longitude: originCity.longitude,
      displayValue: originCity.displayValue, nearestDomicileCode: originCity.nearestDomicileCode,
      isCityLive: false, isAnywhere: false, uniqueKey: originCity.uniqueKey,
    };
    payload.endLocationList = [{
      displayValue: destCity.displayValue, stateCode: destCity.stateCode, isCityLive: false,
      latitude: destCity.latitude, longitude: destCity.longitude, name: destCity.name,
      nearestDomicileCode: destCity.nearestDomicileCode,
    }];

    // ── the one and only posting call ──
    var result = await submitOrder(payload);
    logger.log('patBridge', 'patBridgeSubmit: submitOrder returned', {
      ok: result.ok, status: result.status,
    });
    return {
      ok: result.ok === true,
      status: result.status,
      // The real body on failure, so the site shows Amazon's own words rather than a paraphrase.
      body: result.body === undefined ? null : result.body,
    };
  } catch (e) {
    logger.error('patBridge', 'patBridgeSubmit threw', { error: e });
    return { ok: false, status: 0, body: String(e) };
  }
}

// ── The service worker is the only caller. The website never reaches this listener directly. ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  if (msg.type === 'RELAY_TAB_STATUS') {
    try { sendResponse(patBridgeTabStatus()); }
    catch (e) {
      logger.error('patBridge', 'RELAY_TAB_STATUS failed', { error: e });
      sendResponse({ isLoadBoard: false, signedIn: false, accounts: [] });
    }
    return false;
  }

  if (msg.type === 'RELAY_TAB_SUBMIT') {
    patBridgeSubmit(msg)
      .then(sendResponse)
      .catch(function (e) { sendResponse({ ok: false, status: 0, body: String(e) }); });
    return true; // async
  }

  return false;
});
