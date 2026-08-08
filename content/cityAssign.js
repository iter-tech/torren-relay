// cityAssign.js — foundation for per-city load splitting (2026-08-06).
//
// READ-ONLY RECONNAISSANCE. This file answers ONE question and then prints the answer:
// "which active origin city does each load card on screen belong to?" It changes NOTHING the
// dispatcher sees. There is no hiding, no filtering, no reordering, no restyling, no badge, no
// UI of any kind. It does not add, remove or modify a single node in Amazon's DOM, and it never
// clicks anything. Its entire output is console lines.
//
// It exists so the assignment can be checked against a real board BEFORE anything acts on it.
// If the counts it prints do not match what the dispatcher sees, we find out here, at zero risk,
// rather than after loads have been hidden from him.
//
// ── GATED OFF BY DEFAULT ──────────────────────────────────────────────────────────────────
// Nothing below runs unless CITY_ASSIGN_DEBUG (utils/constants.js) is true. Turning it on is a
// FOUR-SWITCH, THREE-FILE operation, because the data rides on the existing capture path and
// the output rides on the existing log-level gate:
//   1. DEBUG_LEVEL        -> 3   (utils/constants.js)          — logger.log needs >= 3
//   2. CAPTURE_RESPONSES  -> true (utils/constants.js)
//   3. CAPTURE_RESPONSES  -> true (content/networkObserver.js — MAIN-world mirror)
//   4. CITY_ASSIGN_DEBUG  -> true (BOTH utils/constants.js and networkObserver.js)
// Leaving any one of them off makes this file silent. That is deliberate: the log lines here
// contain city names and work-opportunity ids, and the level gate is the backstop that keeps
// them out of a stock build even if a flag is left on by mistake.
//
// ── WHY THE ASSIGNMENT IS GEOMETRIC, NOT TEXTUAL ──────────────────────────────────────────
// The obvious approach — compare the card's origin city text to the filter chip text — does not
// work. State formatting in the captured response is inconsistent within a SINGLE response
// (verified: "IL" alongside "Ohio" alongside "Indiana"), so string matching would silently
// mis-assign. We therefore never match on city or state strings anywhere in this file. We use
// the PICKUP stop's latitude/longitude and take the nearest active city by great-circle
// distance. Coordinates do not have formatting variants.

// Great-circle radius in miles. Haversine on a sphere is accurate to ~0.5% at these distances,
// which is far inside the tolerance of a "which of 5 cities is nearest" question.
var CITY_ASSIGN_EARTH_RADIUS_MI = 3958.8;

// ⚠ A GUESS, NOT A KNOWN VALUE. Dispatcher radius has been seen set from 25 to 100 miles, so a
// pickup should normally sit well inside 100 mi of its city. 150 leaves headroom for a wide
// radius plus the difference between the city centroid the cities endpoint returns and the
// actual warehouse. It is here to stop a load being FORCED onto a city it has nothing to do
// with — an unmatched card is an honest answer, a wrongly-attributed one is not.
// TUNE THIS AGAINST REAL LOGS. If genuine loads show up as unmatched with distances of
// 150–250 mi, raise it. If junk is being absorbed, lower it.
var CITY_ASSIGN_MAX_MILES = 150;

// A refresh can deliver several /search responses (other saved-search tabs). We keep the last
// few and choose between them by id overlap with the cards actually on screen — see pickBuffer.
var CITY_ASSIGN_MAX_BUFFERS = 4;

// The response arrives BEFORE React has rendered the cards it describes, so reading the DOM at
// arrival would find the previous page's cards (or none). This waits for the render to settle
// and coalesces the burst of responses a single refresh produces into ONE cycle.
// ⚠ ALSO A GUESS — tune against real logs. If cycles report "no captured response matches the
// cards on screen" on a slow board, this is the first thing to raise.
var CITY_ASSIGN_SETTLE_MS = 700;

var _cityAssignBuffers  = [];    // recent captured responses, oldest first
var _cityAssignTimer    = null;  // settle-debounce handle
var _cityAssignRunning  = false; // re-entry guard — the cycle awaits, refreshes do not wait
var _cityAssignListener = null;  // kept so teardown can remove exactly what init added

// city string ("TULSA, OK") -> { lat, lng } or null when unresolvable.
//
// NEGATIVE RESULTS ARE CACHED TOO (the null). Without that, a city the endpoint cannot resolve
// would be re-requested on every single refresh forever. See resolveCityCoords for the cost
// note — this cache is the only reason this feature is not a per-refresh network call.
var _cityCoordCache = {};

// ── GEOMETRY ──────────────────────────────────────────────────────────────────────────────

// NO logger.log at entry here, deliberately, and this is the ONLY function in the file that
// omits it. It runs cards x cities times per cycle (~250 calls on a 50-card, 5-city board);
// logging each one would produce 250 console lines per refresh and drown the summary this
// feature exists to print. Pure arithmetic, no I/O, nothing to fail — there is nothing a
// per-call entry line would tell anyone. Every caller logs.
function haversineMiles(lat1, lng1, lat2, lng2) {
  var toRad = Math.PI / 180;
  var dLat  = (lat2 - lat1) * toRad;
  var dLng  = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return CITY_ASSIGN_EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "MOUNT JULIET, TN" -> { city: 'MOUNT JULIET', state: 'TN' }
// Splits on the LAST comma: city names may contain one, the trailing state code may not.
function parseCityState(cityString) {
  logger.log('cityAssign', 'parseCityState called');
  var s = String(cityString || '').trim();
  var ci = s.lastIndexOf(',');
  if (ci === -1) return { city: s, state: '' };
  return { city: s.slice(0, ci).trim(), state: s.slice(ci + 1).trim().toUpperCase() };
}

// ── INPUTS ────────────────────────────────────────────────────────────────────────────────

// Reads the join ids of the load cards currently rendered.
//
// Selectors and the id lookup are taken verbatim from loadParser.js (see AMAZON_SELECTORS.md,
// "Load card (Layout A)") so the two cannot drift apart about what a card is.
//
// loadParser filters out cards nested inside other cards; we do not need to, because a nested
// match resolves to the same inner div[id] and the dedupe below collapses it. Same result,
// less work.
//
// PURE READS: querySelector / querySelectorAll / .id only. No getBoundingClientRect, no
// offsetWidth/Height, no getComputedStyle — nothing that forces a layout pass. This function
// cannot make the board janky.
function readRenderedCardIds() {
  logger.log('cityAssign', 'readRenderedCardIds called');
  var ids = [];
  try {
    // FIRST div.load-list only. The second is "Similar matches" and is not part of the
    // dispatcher's origin-city board — including it would inflate the counts.
    var mainList = document.querySelector('div.load-list');
    if (!mainList) return ids;
    var cards = mainList.querySelectorAll(
      'div.load-card, div.load-card__selected, div.wo-card-header--highlighted'
    );
    for (var i = 0; i < cards.length; i++) {
      var idEl = cards[i].querySelector('div[id]');
      if (!idEl || !idEl.id) continue;
      if (ids.indexOf(idEl.id) === -1) ids.push(idEl.id);
    }
  } catch (e) {
    logger.error('cityAssign', 'readRenderedCardIds failed', { error: e });
    return [];
  }
  return ids;
}

// Resolves one origin city to coordinates, via the same cities endpoint Post-a-Truck uses.
//
// ⚠ COST NOTE. resolvePATCity() is a live fetch and is NOT memoised inside patApi.js — every
// call there hits the network (and up to three times, counting its abbreviation and prefix
// retries). This cache is what stops that becoming a per-refresh network call: each distinct
// city is resolved ONCE per page session, then answered from memory forever. A board with 5
// cities refreshing every 20s makes 5 requests total, not 5 per refresh.
// The cache is in-memory only and dies with the page — a reload re-resolves. Whether it should
// persist to chrome.storage is deliberately NOT decided here.
async function resolveCityCoords(cityString) {
  logger.log('cityAssign', 'resolveCityCoords called');
  if (Object.prototype.hasOwnProperty.call(_cityCoordCache, cityString)) {
    return _cityCoordCache[cityString];
  }
  var parsed = parseCityState(cityString);
  try {
    var res = await resolvePATCity({ city: parsed.city, state: parsed.state });
    if (!res || typeof res.latitude !== 'number' || typeof res.longitude !== 'number') {
      _cityCoordCache[cityString] = null;
      logger.warn('cityAssign', 'city coordinates unresolved — city skipped this cycle', {
        city: cityString
      });
      return null;
    }
    _cityCoordCache[cityString] = { lat: res.latitude, lng: res.longitude };
    return _cityCoordCache[cityString];
  } catch (e) {
    // Never throw out of here: one unresolvable city must not abort the whole cycle.
    logger.error('cityAssign', 'resolveCityCoords failed', { error: e, city: cityString });
    _cityCoordCache[cityString] = null;
    return null;
  }
}

// Chooses which captured response describes the board on screen.
//
// A refresh can deliver more than one /search response (other saved-search tabs), and the
// newest is NOT reliably the right one. The right one is whichever shares the most ids with the
// cards actually rendered, so that is what we measure. Both counts are logged so a wrong pick
// is visible rather than silent.
function pickBuffer(cardIds) {
  logger.log('cityAssign', 'pickBuffer called');
  var best = null;
  var bestCount = -1;
  var breakdown = [];
  for (var i = 0; i < _cityAssignBuffers.length; i++) {
    var buf = _cityAssignBuffers[i];
    var n = 0;
    for (var j = 0; j < cardIds.length; j++) {
      if (Object.prototype.hasOwnProperty.call(buf.byId, cardIds[j])) n++;
    }
    breakdown.push(buf.endpoint + '#' + i + ': ' + n + '/' + cardIds.length);
    if (n > bestCount) { bestCount = n; best = buf; }
  }
  if (bestCount <= 0) {
    logger.warn('cityAssign', 'no captured response intersects the cards on screen — cycle skipped', {
      buffers: _cityAssignBuffers.length, cardCount: cardIds.length, intersections: breakdown.join(' | ')
    });
    return null;
  }
  logger.log('cityAssign', 'response chosen by id intersection', {
    chosen: best.endpoint, intersection: bestCount + '/' + cardIds.length,
    allBuffers: breakdown.join(' | ')
  });
  return best;
}

// ── DIAGNOSTICS (2026-08-08) ──────────────────────────────────────────────────────────────
//
// Added after a live run showed 6 of 11 cards as "id not in any response", with the missing
// cards all belonging to ONE city (Chicago showed 2, should have been 8). That reason string is
// produced by testing the SELECTED buffer only, so on its own it cannot tell apart:
//
//   A. PAGINATION      — the board shows more cards than the captured page contained, so the
//                        later ones were never in any body we read.
//   B. WRONG RESPONSE  — the ids DO exist, in a buffered response that pickBuffer() did not
//                        select. One /search per saved-search tab would look exactly like this.
//   C. MISSING COORDS  — the ids are in the selected response, but the lat/lng path is absent.
//
// PURE LOGGING. Nothing below changes the assignment, the selection, or the DOM. It re-reads
// state the cycle already has and prints it.

// Small helper — these buffers are plain objects, so there is no .size to read.
function countKeys(obj) {
  var n = 0;
  for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) n++; }
  return n;
}

// Parts 1-3. Deliberately logged BEFORE pickBuffer() decides anything, so a cycle that bails
// out with "no captured response intersects" still leaves the full inventory in the console —
// that cycle is exactly the one worth diagnosing.
function logBufferInventory(cardIds) {
  logger.log('cityAssign', 'logBufferInventory called');
  try {
    // ── 1. what is buffered ──
    logger.log('cityAssign', 'CITY DIAG 1/4  buffered responses this cycle: ' +
      _cityAssignBuffers.length);
    for (var i = 0; i < _cityAssignBuffers.length; i++) {
      var b = _cityAssignBuffers[i];
      var idCount = b.withCoords + countKeys(b.noCoord);
      var total   = (b.totalResultsSize === null || b.totalResultsSize === undefined)
                      ? 'unknown' : b.totalResultsSize;
      var token   = (b.nextItemToken === null || b.nextItemToken === undefined)
                      ? 'none' : b.nextItemToken;
      // "ids" is what this response actually carried; "totalResultsSize" is what the server says
      // exists overall. ids < totalResultsSize means there are pages we never saw.
      logger.log('cityAssign',
        'CITY DIAG 1/4  response #' + i + ' [' + b.endpoint + ']' +
        '  ids: ' + idCount +
        ' (withCoords ' + b.withCoords + ', noCoord ' + countKeys(b.noCoord) + ')' +
        '  totalResultsSize: ' + total +
        '  nextItemToken: ' + token);
    }

    // ── 2. what is on screen ──
    logger.log('cityAssign', 'CITY DIAG 2/4  load-card ids in DOM: ' + cardIds.length);

    // ── 3. overlap, per response ──
    var parts = [];
    for (var j = 0; j < _cityAssignBuffers.length; j++) {
      var bb = _cityAssignBuffers[j];
      var hit = 0;
      for (var k = 0; k < cardIds.length; k++) {
        if (Object.prototype.hasOwnProperty.call(bb.byId, cardIds[k]) ||
            Object.prototype.hasOwnProperty.call(bb.noCoord, cardIds[k])) hit++;
      }
      parts.push('#' + j + ' [' + bb.endpoint + ']: ' + hit + '/' + cardIds.length);
    }
    logger.log('cityAssign', 'CITY DIAG 3/4  DOM ids found in each response: ' +
      (parts.length ? parts.join(' | ') : '(no responses buffered)'));
  } catch (e) {
    logger.error('cityAssign', 'logBufferInventory failed', { error: e, cards: cardIds.length });
  }
}

// ── ID-SHAPE SAMPLES (2026-08-08) ─────────────────────────────────────────────────────────
//
// Added after a live run reported 0/50 overlap across ALL FOUR buffers. A pagination gap would
// still match the captured page, so zero overlap means the two id sets are simply not the same
// strings. Everything below prints RAW VALUES and containment results — it draws no conclusion
// and changes no behaviour.
//
// Pipe-wrapped (|like this|) so leading/trailing whitespace is visible in the console.

function pipe(v) {
  if (v === null || v === undefined) return '(' + String(v) + ')';
  return '|' + String(v) + '|';
}

// Every data-* attribute on one element, as "name=|value|" strings.
function collectDataAttrs(el) {
  var out = [];
  try {
    var attrs = (el && el.attributes) || [];
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.lastIndexOf('data-', 0) === 0) {
        out.push(attrs[i].name + '=' + pipe(attrs[i].value));
      }
    }
  } catch (e) {
    logger.error('cityAssign', 'collectDataAttrs failed', { error: e });
  }
  return out;
}

// Sweeps the WHOLE card for data-* values that look like a UUID. If the join key is not on an
// id attribute at all, this is what finds it — and it is the first thing to check when the DOM
// and JSON id sets share nothing.
function findUuidLikeDataAttrs(card) {
  var hits = [];
  try {
    var all = card.querySelectorAll('*');
    var re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (var i = 0; i < all.length && hits.length < 6; i++) {
      var attrs = all[i].attributes || [];
      for (var j = 0; j < attrs.length; j++) {
        if (attrs[j].name.lastIndexOf('data-', 0) !== 0) continue;
        if (!re.test(attrs[j].value)) continue;
        hits.push('<' + all[i].tagName + '> ' + attrs[j].name + '=' + pipe(attrs[j].value));
        break;
      }
    }
  } catch (e) {
    logger.error('cityAssign', 'findUuidLikeDataAttrs failed', { error: e });
  }
  return hits;
}

// Where the DOM id actually comes from. readRenderedCardIds() takes the FIRST descendant
// matching 'div[id]' — which is only correct if that descendant is the load. If Amazon wrapped
// the card in anything id-bearing, we would be reading a layout wrapper and never know. So this
// lists EVERY id-bearing descendant plus every data-* attribute, not just the one we pick.
function readCardIdProvenance(limit) {
  logger.log('cityAssign', 'readCardIdProvenance called');
  var out = [];
  try {
    var mainList = document.querySelector('div.load-list');
    if (!mainList) return out;
    var cards = mainList.querySelectorAll(
      'div.load-card, div.load-card__selected, div.wo-card-header--highlighted'
    );
    for (var i = 0; i < cards.length && out.length < limit; i++) {
      var card = cards[i];
      var chosen = card.querySelector('div[id]');
      var withId = card.querySelectorAll('[id]');
      var idEls = [];
      for (var j = 0; j < withId.length && j < 8; j++) {
        idEls.push({
          tag: withId[j].tagName,
          isChosen: withId[j] === chosen,
          // className can be an SVGAnimatedString; String() keeps this from throwing.
          cls: String(withId[j].className || '').slice(0, 60),
          idProp: withId[j].id,
          idAttr: withId[j].getAttribute ? withId[j].getAttribute('id') : null,
          // data-* on EVERY id-bearing element, not just the chosen one. When the join is
          // broken the real key is most likely on an element we are NOT reading, so listing
          // only the chosen element's attributes would hide exactly what we are looking for.
          data: collectDataAttrs(withId[j])
        });
      }
      out.push({
        cardTag: card.tagName, cardCls: String(card.className || '').slice(0, 80),
        cardDataAttrs: collectDataAttrs(card),
        chosenData: chosen ? collectDataAttrs(chosen) : [],
        uuidLikeData: findUuidLikeDataAttrs(card),
        idEls: idEls, idElCount: withId.length
      });
    }
  } catch (e) {
    logger.error('cityAssign', 'readCardIdProvenance failed', { error: e });
  }
  return out;
}

// Index of the first differing character, or -1 when one is a prefix of the other.
function firstDivergence(a, b) {
  var n = Math.min(a.length, b.length);
  for (var i = 0; i < n; i++) { if (a.charAt(i) !== b.charAt(i)) return i; }
  return (a.length === b.length) ? -1 : n;
}

// Of all ids in a response, the one sharing the longest prefix with `domId` — the most
// informative thing to diff against when nothing matches exactly.
function nearestJsonId(domId, buf) {
  var best = null, bestLen = -1;
  var keys = [];
  for (var k in buf.byId) { if (Object.prototype.hasOwnProperty.call(buf.byId, k)) keys.push(k); }
  for (var k2 in buf.noCoord) {
    if (Object.prototype.hasOwnProperty.call(buf.noCoord, k2)) keys.push(k2);
  }
  for (var i = 0; i < keys.length; i++) {
    var d = firstDivergence(domId, keys[i]);
    var shared = (d === -1) ? Math.min(domId.length, keys[i].length) : d;
    if (shared > bestLen) { bestLen = shared; best = keys[i]; }
  }
  return { id: best, shared: bestLen };
}

function logIdShapeSamples(cardIds) {
  logger.log('cityAssign', 'logIdShapeSamples called');
  try {
    var buf0 = _cityAssignBuffers.length ? _cityAssignBuffers[0] : null;

    // ── 1. the DOM side, raw ──
    logger.log('cityAssign',
      'CITY RAW 1  DOM ids read from: document.querySelector("div.load-list") ' +
      '-> .querySelectorAll("div.load-card, div.load-card__selected, ' +
      'div.wo-card-header--highlighted") -> per card .querySelector("div[id]") ' +
      '-> the .id DOM PROPERTY of that CHILD element (not the card itself, not a data-* attr)');
    for (var i = 0; i < cardIds.length && i < 3; i++) {
      logger.log('cityAssign', 'CITY RAW 1  DOM ID [' + i + ']: ' + pipe(cardIds[i]) +
        '  length: ' + cardIds[i].length);
    }
    var prov = readCardIdProvenance(3);
    for (var p = 0; p < prov.length; p++) {
      var pr = prov[p];
      logger.log('cityAssign', 'CITY RAW 1  card [' + p + '] <' + pr.cardTag + '> class=' +
        pipe(pr.cardCls) + '  data-* on card: ' +
        (pr.cardDataAttrs.length ? pr.cardDataAttrs.join(' ') : '(none)') +
        '  data-* on chosen id element: ' +
        (pr.chosenData.length ? pr.chosenData.join(' ') : '(none)'));
      logger.log('cityAssign', 'CITY RAW 1  card [' + p + '] has ' + pr.idElCount +
        ' id-bearing descendant(s); first ' + pr.idEls.length + ':');
      for (var q = 0; q < pr.idEls.length; q++) {
        var e = pr.idEls[q];
        logger.log('cityAssign', 'CITY RAW 1    ' + (e.isChosen ? '>> CHOSEN ' : '   ') +
          '<' + e.tag + '> class=' + pipe(e.cls) +
          '  .id=' + pipe(e.idProp) + '  getAttribute("id")=' + pipe(e.idAttr) +
          '  (.id and getAttribute agree: ' + (e.idProp === e.idAttr) + ')' +
          '  data-*: ' + (e.data.length ? e.data.join(' ') : '(none)'));
      }
      // The single most useful line when the two id sets share nothing: a UUID sitting in a
      // data-* attribute means the join key exists in the DOM, just not where we read it.
      logger.log('cityAssign', 'CITY RAW 1  card [' + p + '] UUID-shaped data-* anywhere in ' +
        'the card: ' + (pr.uuidLikeData.length ? pr.uuidLikeData.join('  ') : '(none found)'));
    }

    // ── 2. the JSON side, raw ──
    if (!buf0) {
      logger.log('cityAssign', 'CITY RAW 2  no response buffered — nothing to sample');
    } else {
      logger.log('cityAssign', 'CITY RAW 2  response #0 [' + buf0.endpoint + '] rawBodyLength: ' +
        buf0.rawBodyLength + (buf0.rawBodyTruncated ? ' (TRUNCATED for the probe)' : ''));
      var samples = buf0.idSamples || [];
      if (!samples.length) logger.log('cityAssign', 'CITY RAW 2  no id samples in response #0');
      for (var s = 0; s < samples.length; s++) {
        logger.log('cityAssign', 'CITY RAW 2  JSON ID [' + s + '] from ' + samples[s].path +
          ': ' + pipe(samples[s].id) +
          '  length: ' + (samples[s].id === null ? 'n/a' : samples[s].id.length) +
          '  typeof: ' + samples[s].idType);
      }
    }

    // ── 3. containment, both directions ──
    // The point of scanning the WHOLE body rather than the id field: if the DOM id exists in the
    // response under some other key, the join is looking in the wrong place, not at absent data.
    if (buf0 && cardIds.length) {
      var dom0 = cardIds[0];
      var inBody = (typeof buf0.rawBody === 'string') ? buf0.rawBody.indexOf(dom0) !== -1 : null;
      logger.log('cityAssign', 'CITY RAW 3  DOM ID [0] ' + pipe(dom0) +
        ' appears anywhere in response #0 raw text: ' +
        (inBody === null ? 'UNKNOWN (no raw body retained)' : (inBody ? 'YES' : 'NO')) +
        (buf0.rawBodyTruncated ? '  ⚠ body was truncated — a NO here is not proof of absence' : ''));
    }
    if (buf0 && buf0.idSamples && buf0.idSamples.length && buf0.idSamples[0].id) {
      var json0 = buf0.idSamples[0].id;
      // innerHTML, not textContent: ids live in attributes, which textContent does not include.
      // This is a read; it serialises the DOM but forces no layout.
      var html = (document.body && document.body.innerHTML) || '';
      logger.log('cityAssign', 'CITY RAW 3  JSON ID [0] ' + pipe(json0) +
        ' appears anywhere in document.body.innerHTML: ' +
        (html.indexOf(json0) !== -1 ? 'YES' : 'NO') +
        '  (searched ' + html.length + ' chars)');
    }

    // ── 4. character-by-character divergence ──
    if (buf0 && cardIds.length) {
      var d0 = cardIds[0];
      var near = nearestJsonId(d0, buf0);
      if (!near.id) {
        logger.log('cityAssign', 'CITY RAW 4  response #0 contains no ids to compare against');
      } else {
        var at = firstDivergence(d0, near.id);
        logger.log('cityAssign', 'CITY RAW 4  nearest JSON id to DOM ID [0]:');
        logger.log('cityAssign', 'CITY RAW 4    DOM : ' + pipe(d0) + '  (len ' + d0.length + ')');
        logger.log('cityAssign', 'CITY RAW 4    JSON: ' + pipe(near.id) + '  (len ' + near.id.length + ')');
        if (at === -1) {
          logger.log('cityAssign', 'CITY RAW 4    IDENTICAL — if the join still fails the ' +
            'lookup key is wrong, not the string');
        } else {
          logger.log('cityAssign', 'CITY RAW 4    shared prefix: ' + at + ' char(s) = ' +
            pipe(d0.slice(0, at)) +
            '  |  first difference at index ' + at + ': DOM ' + pipe(d0.charAt(at)) +
            ' vs JSON ' + pipe(near.id.charAt(at)));
          logger.log('cityAssign', 'CITY RAW 4    DOM remainder after divergence: ' +
            pipe(d0.slice(at)) + '  JSON remainder: ' + pipe(near.id.slice(at)));
        }
      }
      // Shape hints — decoration on the DOM id is the usual cause of a whole-set mismatch.
      //
      // Every test below runs on the TRIMMED value, with whitespace reported separately.
      // Testing the raw string instead lets a stray space mask everything else: /[-_]\d+$/
      // cannot match "…-2 ", so a real trailing index would go unreported purely because the
      // id also had whitespace.
      var hints = [];
      var t0 = d0.trim();
      if (d0 !== t0) hints.push('has leading/trailing WHITESPACE (all checks below use the ' +
        'trimmed value ' + pipe(t0) + ')');
      if (t0.indexOf(':') !== -1) hints.push('contains a COLON segment -> ' +
        pipe(t0.slice(0, t0.indexOf(':'))) + ' + ' + pipe(t0.slice(t0.indexOf(':'))));
      var m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(t0);
      if (m && m.index > 0) hints.push('UUID is PREFIXED by ' + pipe(t0.slice(0, m.index)));
      if (m && (m.index + m[1].length) < t0.length) {
        hints.push('UUID is SUFFIXED by ' + pipe(t0.slice(m.index + m[1].length)));
      }
      if (/[-_]\d+$/.test(t0)) hints.push('ends with a TRAILING INDEX -> ' +
        pipe(/[-_]\d+$/.exec(t0)[0]));
      if (!m) hints.push('contains NO UUID at all');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t0)) {
        hints.push('NOT a bare UUID');
      }
      logger.log('cityAssign', 'CITY RAW 4  DOM ID [0] shape: ' +
        (hints.length ? hints.join(' | ') : 'bare UUID, no decoration detected'));
    }
  } catch (e) {
    logger.error('cityAssign', 'logIdShapeSamples failed', {
      error: e, cards: cardIds ? cardIds.length : null, buffers: _cityAssignBuffers.length
    });
  }
}

// Part 4 — the one that actually separates A from B from C.
//
// Takes the unmatched list the cycle just built and asks, for each id, where it COULD have been
// found: nowhere at all, in a response we passed over, or in the one we picked but without
// coordinates.
function logUnmatchedProvenance(unmatched, chosen, cardIds) {
  logger.log('cityAssign', 'logUnmatchedProvenance called');
  try {
    var absentAll = 0;          // in no buffered response at all       -> A (or never captured)
    var inOther = 0;            // in a response we did NOT select      -> B
    var inChosenNoCoord = 0;    // in the selected response, no lat/lng -> C
    var tooFar = 0;             // matched fine, just implausibly far   -> none of the three
    var otherWhere = [];        // which non-selected response held it

    for (var i = 0; i < unmatched.length; i++) {
      var id = unmatched[i].id;
      // Distance rejections are not lookup failures — counted separately so they cannot be
      // mistaken for a data problem.
      if (unmatched[i].why.indexOf('nearest city') === 0) { tooFar++; continue; }

      if (chosen && Object.prototype.hasOwnProperty.call(chosen.noCoord, id)) {
        inChosenNoCoord++;
        continue;
      }
      var foundElsewhere = -1;
      for (var b = 0; b < _cityAssignBuffers.length; b++) {
        var buf = _cityAssignBuffers[b];
        if (buf === chosen) continue;
        if (Object.prototype.hasOwnProperty.call(buf.byId, id) ||
            Object.prototype.hasOwnProperty.call(buf.noCoord, id)) { foundElsewhere = b; break; }
      }
      if (foundElsewhere !== -1) {
        inOther++;
        if (otherWhere.indexOf(foundElsewhere) === -1) otherWhere.push(foundElsewhere);
      } else {
        absentAll++;
      }
    }

    logger.log('cityAssign',
      'CITY DIAG 4/4  unmatched provenance — ' +
      'absent from ALL responses: ' + absentAll + ' | ' +
      'present in a NON-selected response: ' + inOther +
        (otherWhere.length ? ' (in response #' + otherWhere.join(', #') + ')' : '') + ' | ' +
      'in selected response but no coords: ' + inChosenNoCoord + ' | ' +
      'over max distance: ' + tooFar);

    // ── VERDICT ──
    // A hint, not a proof: it reports which hypothesis the numbers are CONSISTENT WITH. The
    // counts above are the evidence; this line just saves reading them cold.
    var verdict;
    if (inOther > 0) {
      verdict = 'B (WRONG RESPONSE SELECTED) — those ids were buffered, in a response ' +
                'pickBuffer() passed over. One /search per saved-search tab looks like this. ' +
                'Fix direction: merge all buffers instead of picking one.';
    } else if (inChosenNoCoord > 0) {
      verdict = 'C (MISSING COORDINATES) — the ids are in the selected response, but its ' +
                'loads[0].stops[0].location has no numeric lat/lng. Fix direction: the ' +
                'coordinate path, not the selection.';
    } else if (absentAll > 0) {
      // Pagination only explains this if the capture was genuinely short of the full result set.
      var chosenIds = chosen ? (chosen.withCoords + countKeys(chosen.noCoord)) : 0;
      var paginated = !!chosen &&
        ((chosen.nextItemToken !== null && chosen.nextItemToken !== undefined) ||
         (typeof chosen.totalResultsSize === 'number' && chosen.totalResultsSize > chosenIds));
      if (paginated) {
        verdict = 'A (PAGINATION) — ' + absentAll + ' id(s) in no captured response, and the ' +
                  'selected response is short of the full set (ids ' + chosenIds +
                  ', totalResultsSize ' + chosen.totalResultsSize +
                  ', nextItemToken ' + (chosen.nextItemToken === null ||
                    chosen.nextItemToken === undefined ? 'none' : chosen.nextItemToken) +
                  '). Fix direction: capture the later pages.';
      } else {
        verdict = 'NONE OF A/B/C — ' + absentAll + ' id(s) are in NO buffered response, yet the ' +
                  'selected response is NOT paginated short (ids ' + chosenIds +
                  ', totalResultsSize ' + (chosen ? chosen.totalResultsSize : 'n/a') +
                  ', nextItemToken none). So the request carrying them was never captured at ' +
                  'all — it fired before the observer installed, was served from cache, or ' +
                  'used an endpoint outside CAPTURE_PATHS. Fix direction: find the missing ' +
                  'request, not the assignment logic.';
      }
    } else {
      verdict = 'no unmatched lookup failures this cycle';
    }
    logger.log('cityAssign', 'CITY DIAG VERDICT  ' + verdict);
  } catch (e) {
    logger.error('cityAssign', 'logUnmatchedProvenance failed', {
      error: e, unmatched: unmatched ? unmatched.length : null, cards: cardIds ? cardIds.length : null
    });
  }
}

// ── THE CYCLE ─────────────────────────────────────────────────────────────────────────────

// One assignment pass. Reads, computes, logs, and touches nothing.
//
// COST: cards x cities distance computations — ~250 on a 50-card, 5-city board. Pure
// arithmetic (multiply, sqrt, atan2), no DOM writes and no layout reads, so it is well under a
// millisecond and cannot affect rendering. The DOM is read exactly once, up front.
async function runCityAssignCycle() {
  logger.log('cityAssign', 'runCityAssignCycle called');
  // The cycle awaits city resolution on its first run; refreshes do not wait for it. Without
  // this guard a second refresh could interleave and double-count.
  if (_cityAssignRunning) {
    logger.log('cityAssign', 'cycle already running — skipping this trigger');
    return;
  }
  _cityAssignRunning = true;
  try {
    var cardIds = readRenderedCardIds();
    if (cardIds.length === 0) {
      logger.warn('cityAssign', 'no load cards rendered — cycle skipped');
      return;
    }
    // Diagnostics parts 1-3 (2026-08-08). BEFORE pickBuffer, so the inventory is printed even
    // on a cycle that bails out below — that cycle is the most worth diagnosing.
    logBufferInventory(cardIds);
    // Raw id samples (2026-08-08). Also before pickBuffer: when overlap is zero there IS no
    // selected response, and this block is precisely what explains why.
    logIdShapeSamples(cardIds);

    var buf = pickBuffer(cardIds);
    if (!buf) return;  // pickBuffer already logged why

    // Reused from originCities.js, NOT re-scraped — see getActiveOriginCities() there.
    var cities = getActiveOriginCities();
    if (!cities.length) {
      logger.warn('cityAssign', 'no active origin cities available — cycle skipped', {
        cardCount: cardIds.length
      });
      return;
    }

    // Resolve coordinates. Cached, so this awaits the network only on the first cycle after a
    // city appears; every later cycle resolves from memory.
    var resolved = [];
    for (var ci = 0; ci < cities.length; ci++) {
      var coords = await resolveCityCoords(cities[ci]);
      if (!coords) continue;   // already warned by name inside resolveCityCoords
      resolved.push({ name: cities[ci], lat: coords.lat, lng: coords.lng });
    }
    if (resolved.length === 0) {
      logger.warn('cityAssign', 'no origin city could be resolved to coordinates — cycle skipped', {
        cities: cities.length
      });
      return;
    }

    var counts = {};
    for (var ri = 0; ri < resolved.length; ri++) counts[resolved[ri].name] = 0;
    var unmatched = [];

    for (var k = 0; k < cardIds.length; k++) {
      var id = cardIds[k];
      var pickup = Object.prototype.hasOwnProperty.call(buf.byId, id) ? buf.byId[id] : null;
      if (!pickup) {
        unmatched.push({
          id: id,
          why: buf.noCoord[id] ? 'no coord in JSON' : 'id not in any response'
        });
        continue;
      }
      var bestCity = null;
      var bestDist = Infinity;
      for (var m = 0; m < resolved.length; m++) {
        var d = haversineMiles(pickup.lat, pickup.lng, resolved[m].lat, resolved[m].lng);
        if (d < bestDist) { bestDist = d; bestCity = resolved[m].name; }
      }
      // Too far to be credible — counted as unmatched rather than forced onto a city.
      if (bestDist > CITY_ASSIGN_MAX_MILES) {
        unmatched.push({
          id: id,
          why: 'nearest city ' + Math.round(bestDist) + ' mi > ' + CITY_ASSIGN_MAX_MILES + ' mi max'
        });
        continue;
      }
      counts[bestCity]++;
    }

    // THE line this whole file exists to print.
    var parts = [];
    for (var pi = 0; pi < resolved.length; pi++) {
      parts.push(resolved[pi].name + ': ' + counts[resolved[pi].name]);
    }
    parts.push('unmatched: ' + unmatched.length);
    logger.log('cityAssign', 'CITY ASSIGN  ' + parts.join(' | '));

    // Second line, same gate: WHY each unmatched card was unmatched. Only when there are any —
    // a clean cycle should not print an empty list.
    if (unmatched.length > 0) {
      var detail = [];
      for (var ui = 0; ui < unmatched.length; ui++) {
        detail.push(unmatched[ui].id + ' (' + unmatched[ui].why + ')');
      }
      logger.log('cityAssign', 'CITY ASSIGN unmatched  ' + detail.join(' | '));
    }

    // Diagnostics part 4 + verdict (2026-08-08). Last, because it classifies the unmatched list
    // the loop above just produced.
    logUnmatchedProvenance(unmatched, buf, cardIds);
  } catch (e) {
    logger.error('cityAssign', 'runCityAssignCycle failed', { error: e });
  } finally {
    // In finally, not at the end of try: an early return or a throw must not wedge the guard on
    // and silence the feature for the rest of the session.
    _cityAssignRunning = false;
  }
}

// ── PLUMBING ──────────────────────────────────────────────────────────────────────────────

// Receives the { id, lat, lng } triples from content/networkObserver.js (MAIN world).
//
// The body itself never crosses: the MAIN world extracts the triples and posts only those, so
// a ~300KB response becomes a few KB of message. See emitCityAssignCoords() there.
function onCityCoordsMessage(ev) {
  logger.log('cityAssign', 'onCityCoordsMessage called');
  try {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data || data.__extRelayCityCoords !== true) return;

    var byId = {};
    var pairs = data.pairs || [];
    for (var i = 0; i < pairs.length; i++) {
      byId[pairs[i].id] = { lat: pairs[i].lat, lng: pairs[i].lng };
    }
    var noCoord = {};
    var nc = data.noCoordIds || [];
    for (var j = 0; j < nc.length; j++) noCoord[nc[j]] = true;

    _cityAssignBuffers.push({
      endpoint: data.endpoint, byId: byId, noCoord: noCoord,
      withCoords: pairs.length, woCount: data.woCount,
      // 2026-08-08: kept per-buffer so the diagnostic can test each response for pagination
      // individually rather than reasoning about the newest one only.
      totalResultsSize: data.totalResultsSize, nextItemToken: data.nextItemToken,
      noCoordCount: nc.length,
      // 2026-08-08 id-shape probe. Debug-only; see the emitter's warning in networkObserver.js.
      // Dropped on teardown with everything else.
      rawBody: data.rawBody, rawBodyTruncated: data.rawBodyTruncated,
      rawBodyLength: data.rawBodyLength, idSamples: data.idSamples || []
    });
    // Bounded: a long session must not accumulate buffers forever.
    while (_cityAssignBuffers.length > CITY_ASSIGN_MAX_BUFFERS) _cityAssignBuffers.shift();

    logger.log('cityAssign', 'pickup coordinates buffered', {
      endpoint: data.endpoint, withCoords: pairs.length,
      withoutCoords: nc.length, woCount: data.woCount, buffers: _cityAssignBuffers.length
    });

    // Debounce rather than run now: the cards this response describes are not rendered yet, and
    // one refresh can deliver several responses. One cycle per settled refresh.
    if (_cityAssignTimer !== null) clearTimeout(_cityAssignTimer);
    _cityAssignTimer = setTimeout(function () {
      _cityAssignTimer = null;
      runCityAssignCycle();
    }, CITY_ASSIGN_SETTLE_MS);
  } catch (e) {
    logger.error('cityAssign', 'onCityCoordsMessage failed', { error: e });
  }
}

// Installed by content.js's activateExtensionUI(). Completely inert when the flag is off — it
// does not even register a listener, so a stock build carries zero runtime cost from this file.
function initCityAssign() {
  logger.log('cityAssign', 'initCityAssign called');
  try {
    if (typeof CITY_ASSIGN_DEBUG === 'undefined' || !CITY_ASSIGN_DEBUG) return;
    if (_cityAssignListener) return;  // idempotent: activation can be re-entered
    _cityAssignListener = onCityCoordsMessage;
    window.addEventListener('message', _cityAssignListener);
    logger.log('cityAssign', 'city-assign debug ACTIVE — read-only, logs only', {
      maxMiles: CITY_ASSIGN_MAX_MILES, settleMs: CITY_ASSIGN_SETTLE_MS
    });
  } catch (e) {
    logger.error('cityAssign', 'initCityAssign failed', { error: e });
  }
}

// Torn down by content.js's deactivateExtensionUI(). Drops the listener, the buffers and the
// pending timer. The resolved-coordinate cache is dropped too: on a re-activation the cities
// may have changed, and re-resolving a handful of cities once is cheaper than reasoning about
// whether a stale entry is still correct.
function teardownCityAssign() {
  logger.log('cityAssign', 'teardownCityAssign called');
  try {
    if (_cityAssignListener) {
      window.removeEventListener('message', _cityAssignListener);
      _cityAssignListener = null;
    }
    if (_cityAssignTimer !== null) {
      clearTimeout(_cityAssignTimer);
      _cityAssignTimer = null;
    }
    _cityAssignBuffers = [];
    _cityCoordCache    = {};
    _cityAssignRunning = false;
  } catch (e) {
    logger.error('cityAssign', 'teardownCityAssign failed', { error: e });
  }
}
