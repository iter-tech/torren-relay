# Amazon Relay API samples (real captured payloads)

> Reference for ext-action-post and any code touching Amazon's internal APIs.
> **Rule: never guess field names, enums, or formats — check here or capture a new sample.**
> All samples captured from the live Relay UI on 2026-07-13/14.

---

## 1. THE KEY TRANSFORMATION — cities response vs. what upsert expects

The cities (autocomplete) endpoint and the order-upsert payload use the **same city object
shape, but with two fields deliberately changed by Amazon's UI** before sending:

| Field | cities API returns | upsert must contain |
|---|---|---|
| `displayValue` | `null` | `"NAME, ST"` (e.g. `"BESSEMER, AL"`) |
| `nearestDomicileCode` | code, e.g. `"MEM"` | `null` |
| `name`, `stateCode`, `country`, `latitude`, `longitude` | as returned | unchanged |

So: take the matched city object from the cities response, set
`displayValue = name + ", " + stateCode`, set `nearestDomicileCode = null`, pass the rest through.

---

## 2. cities (autocomplete) response — sample objects

```json
[
  {"name":"BESSEMER","stateCode":"AL","country":"US","latitude":33.370707,"longitude":-86.971336,"nearestDomicileCode":"BHM","displayValue":null},
  {"name":"BESSEMER CITY","stateCode":"NC","country":"US","latitude":35.284671,"longitude":-81.284137,"nearestDomicileCode":"CLT","displayValue":null},
  {"name":"GREEN","stateCode":"OH","country":"US","latitude":40.948353,"longitude":-81.475653,"nearestDomicileCode":"CLE","displayValue":null},
  {"name":"MESA","stateCode":"AZ","country":"US","latitude":33.402226,"longitude":-111.718676,"nearestDomicileCode":"PHX","displayValue":null},
  {"name":"LEE","stateCode":"MA","country":"US","latitude":42.30685,"longitude":-73.250398,"nearestDomicileCode":"BDL","displayValue":null}
]
```

Notes:
- The search is a substring match: querying "BES" returns BESSEMER, COMBES, FORBES, THEBES, etc.
  Many city names repeat across states (e.g. GREEN exists in 10+ states) — **always match on
  name + stateCode, never name alone.**
- `displayValue` is always `null` in this response.

---

## 3. order-upsert (Post-a-Truck) — full captured payload, 53' Trailer

Status: ✅ confirmed working shape for standard 53' trailer posts.

```json
{
  "startTime": "2026-07-15T18:31:00Z",
  "endTime": "2026-07-16T18:32:00Z",
  "minDistance": { "value": 200.0, "unit": "mi" },
  "maxDistance": { "value": 250.0, "unit": "mi" },
  "totalCost": { "value": 1700.0, "unit": "USD" },
  "runType": "ONE_WAY",
  "driverTypes": ["SOLO"],
  "originCityInfo": {
    "name": "BESSEMER",
    "stateCode": "AL",
    "country": "US",
    "latitude": 33.370707,
    "longitude": -86.971336,
    "nearestDomicileCode": null,
    "displayValue": "BESSEMER, AL"
  },
  "originCityRadius": { "value": 25.0, "unit": "mi" },
  "destinationCityInfo": null,
  "destinationCityRadius": { "value": 25.0, "unit": "mi" },
  "minDurationInMinutes": null,
  "maxDurationInMinutes": null,
  "minNumberOfStops": null,
  "maxNumberOfStops": 2,
  "providedTrailerType": "AMAZON_PROVIDED",
  "equipmentTypes": [
    "FIFTY_THREE_FOOT_TRUCK",
    "SKIRTED_FIFTY_THREE_FOOT_TRUCK",
    "FIFTY_THREE_FOOT_DRY_VAN",
    "FIFTY_THREE_FOOT_A5_AIR_TRAILER",
    "FORTY_FIVE_FOOT_TRUCK"
  ],
  "demandId": null,
  "demandVersion": null,
  "demandOptionId": null,
  "matchType": null,
  "costPerDistance": { "value": 4.5, "distanceUnit": "MI", "currencyUnit": "USD" },
  "endLocationList": [
    {
      "name": "MEMPHIS",
      "stateCode": "TN",
      "country": "US",
      "latitude": 35.104629,
      "longitude": -89.978908,
      "nearestDomicileCode": null,
      "displayValue": "MEMPHIS, TN"
    }
  ],
  "endRegionList": [],
  "exclusionCityList": [],
  "minPickUpBufferInMinutes": 30,
  "loadingTypeList": ["LIVE"],
  "supplyDriverIdList": [],
  "supplyTransientDriverIdList": [],
  "excludeSpecialServices": ["SWING_DOOR"],
  "startTimeWindow": {
    "startTime": "2026-07-15T18:31:00Z",
    "endTime": "2026-07-15T19:31:00Z"
  },
  "id": "8bef350d-2314-4ff2-87b1-284428083549",
  "linkedOrderId": null,
  "alias": "P-XSHG91WGN",
  "version": 1,
  "status": "OPEN",
  "creationTime": "2026-07-14T18:39:04Z",
  "matchingDemands": [],
  "auditMetaData": null,
  "patOrderContext": null,
  "cancellationDetails": { "cancellationReason": null, "cancellationComment": null },
  "repostingDetails": null,
  "isRepostingAllowed": true,
  "isLinkedOrder": false
}
```

Field notes (from captured data, not guessed):
- `id`, `alias`, `version`, `creationTime`, `status` — server-assigned; present in responses.
- `linkedOrderId` — set (e.g. `"L-CVLTHBGNB"`) when the post is part of a linked chain;
  then `isLinkedOrder: true` and `isRepostingAllowed: false`.
- Either `minDistance`/`maxDistance` OR `minDurationInMinutes` can drive the post
  (observed: distance nulls + `minDurationInMinutes: 240`). UI state object also carries
  `distanceOrDuration: "DISTANCE"|"DURATION"`.
- `endLocationList` supports multiple cities (observed up to 3).
- `startTimeWindow` may be `null` (observed on linked orders).
- `loadingTypeList` observed values: `["LIVE"]`, `["DROP"]`.
- `excludeSpecialServices` observed: `["SWING_DOOR"]`.
- `costPerDistance.distanceUnit`: `"MI"` in the posted payload; UI state shows `"mi"` —
  copy the captured POST casing (`"MI"`), not the UI state casing.
- UI-only fields seen in page state but NOT in the POST body (do not send):
  `isAnywhereDestination`, `isCheckingMatchingWork`, `isMatchingWorkLoaded`, `matchingWork`,
  `visibleEquipmentTypes`, `visibleProvidedTrailerType`, `destinationCityInfoForFilter`,
  `distanceOrDuration`, `payoutType`.
- UI state also shows `auditMetaData: {suggestedCostPerDistance, matchOutlookScore}` — response-side data.

Enums observed so far:
- `runType`: `ONE_WAY`
- `driverTypes`: `SOLO`
- `providedTrailerType`: `AMAZON_PROVIDED`
- `equipmentTypes` (53' Trailer): `FIFTY_THREE_FOOT_TRUCK`, `SKIRTED_FIFTY_THREE_FOOT_TRUCK`,
  `FIFTY_THREE_FOOT_DRY_VAN`, `FIFTY_THREE_FOOT_A5_AIR_TRAILER`, `FORTY_FIVE_FOOT_TRUCK`
- `equipmentTypes` (53' Container and Chassis): `FIFTY_THREE_FOOT_CONTAINER`
- `equipmentTypes` (40' Container): `FORTY_FOOT_CONTAINER`
- `equipmentTypes` (26' Truck): `TWENTY_SIX_FOOT_BOX_TRUCK`
- `payoutType` (UI state): `FLAT_RATE`

## 4. order-upsert — 40' Container and 26' Truck (Amazon API data 2026-07-14)

Status: ✅ enabled in ext-action-post 2026-07-14. Full payload not captured — enums confirmed from Amazon API data only. If a post fails, recapture via DevTools → Network → filter "upsert" and compare `equipmentTypes`.

```json
"equipmentTypes": ["FORTY_FOOT_CONTAINER"]      // 40' Container
"equipmentTypes": ["TWENTY_SIX_FOOT_BOX_TRUCK"] // 26' Truck
```

Payload structure assumed identical to section 3 (53' Trailer). All other fields unchanged.

Implementation: `PAT_EQUIPMENT_TYPES_40_CONTAINER` and `PAT_EQUIPMENT_TYPES_26_TRUCK` constants
in `content/patApi.js`; mapped via `PAT_EQUIPMENT_MAP` in `content/patModal.js`.

---

## 5. order-upsert — 53' Container and Chassis (captured 2026-07-14)

Status: ✅ confirmed working; enabled in ext-action-post 2026-07-14.

Payload structure **identical to section 3** (53' Trailer). The only field that differs:

```json
"equipmentTypes": ["FIFTY_THREE_FOOT_CONTAINER"]
```

All other fields — `originCityInfo`, `endLocationList`, `runType`, `driverTypes`,
`providedTrailerType`, `costPerDistance`, `startTimeWindow`, `loadingTypeList`,
`excludeSpecialServices`, all static nulls — are identical to section 3.

Implementation: `PAT_EQUIPMENT_TYPES_CONTAINER` constant in `content/patApi.js`.
Board label `"53' Container and Chassis"` maps to this constant via `PAT_EQUIPMENT_MAP`
in `content/patModal.js`. `buildPatPayload` reads `formState.equipmentTypes` (not hardcoded).

## 5. Equipment types not yet supported (need captured sample before enabling)

No remaining blocked types at this time. For any new type seen on the board:
1. Capture a real manual Post-a-Truck upsert for that equipment via DevTools → Network → filter "upsert".
2. Compare `equipmentTypes` array with all known constants.
3. Add a new `PAT_EQUIPMENT_TYPES_*` constant in `patApi.js` and map it in `PAT_EQUIPMENT_MAP` in `patModal.js`.
4. Append the captured payload here.

## 5. Known open bugs (as of 2026-07-13)

- Payout not rounded before insertion into the form (e.g. `5523.6900000000005`) — fix to 2 decimals.
- One load showed MIN 0 / MAX 26 miles with $/mi equal to the full payout — distance calc bug,
  raw `detail.segments[].stops[]` sample still needed to diagnose.

---

## 6. loadboard/search — MULTI-ORIGIN SEARCH findings (2026-08-05)

Recorded for the planned **Single-Tab Multi-Driver Monitor** (BACKLOG.md). Amazon's Origin filter
accepts up to **five cities** in one search and returns **one merged list**.

Source of the five-city observations: a live capture on 2026-08-05 (LITTLE ROCK AR, CHICAGO IL,
TULSA OK, HEBRON KY, JACKSONVILLE FL; radius 25; 104 results). **⚠️ That capture is NOT in
`samples/`.** Everything below is marked with whether it was verified against the captures that
are on disk (`paired-search.json`, 50 work opportunities, and `similar-1.json`).

### 6.1 There is NO origin attribution — the merged list cannot be split by any field ✅ verified

Every field whose key contains `domicile` / `origin` / `search` / `query` / `filter` / `match` /
`cluster` / `region` / `market` was walked across the whole document. Six distinct paths exist;
**none names a searched city**:

| Path | Real value | What it actually is |
|---|---|---|
| `$.searchAuditId` | `"5b3e57d9-e001-4d54-aacf-33e14c0a741c"` | one opaque UUID for the whole response, not per-WO |
| `$.workOpportunities[].startLocation.domicile` | `"MDW"` | the load's **own** pickup facility domicile |
| `$.workOpportunities[].loads[].stops[].location.domicile` | `"MDW"`, `"CMH"`, `"CLE"` | each stop's own facility domicile |
| `$.workOpportunities[].endLocation.domicile` | `"CMH"`, `"IND"` | the **delivery** facility |
| `$.workOpportunities[].matchDeviationDetails` | `null` (all 50) | populated only on `/similar`, and it is about payout deviation, not origin |
| `$.workOpportunities[].searchChannelStampedDuration` | `{"workOpportunities":0,"bidding":0,"operator":-14297,…}` | timing counters |

Top level carries nothing either: `carrierDetails` is carrier scoring only; `metadata` parses to
`{"reasonList":[{"code":"QUANTITY_LIMITS",…}]}`. Per-WO fields that might have discriminated do
not vary — `relevanceScore` is `0` for all 50, `workOpportunityType` `"ONE_WAY"`, `workType`
`"SPOT"`, and `businessType` / `nationality` / `operatorIds` / `contractId` are all `null`.

**Text-matching the searched city names against the response is useless.** The search is
radius-based, so pickups return as NORTH LITTLE ROCK, MATTESON, HARVEY, ROMEOVILLE, SKOKIE —
names that never appear in the filter.

### 6.2 Pickup coordinates — the field the split must use ✅ verified

```
workOpportunities[].loads[0].stops[0].location.latitude
workOpportunities[].loads[0].stops[0].location.longitude
```

That stop carries `stopType: "PICKUP"` and `stopSequenceNumber: 1`. Real values from
`paired-search.json` WO[0] (`id "dc9fe027-e57f-4f85-9240-16dfea38f4ad"`):
`latitude = 41.5991877`, `longitude = -87.6720695` (facility `IGQ1`, HARVEY IL).

**Populated 50 of 50** work opportunities. Counting every stop in that file: **113 of 113**.

**The coordinates are on the nested `location` object, not on the stop** — `'latitude' in stops[0]`
is `false`. `startLocation` duplicates the same pickup pair (verified identical for WO[0], both
`stopCode "IGQ1"`); `endLocation` duplicates the delivery pair.

Searched-city coordinates come from the **cities endpoint already used for Post-a-Truck** (§2 of
this file: `name`, `stateCode`, `latitude`, `longitude`), so both sides of the distance
comparison are available with no new endpoint.

### 6.3 Do NOT match on city or state strings ⚠️ partly verified

State formatting is inconsistent between records **within a single response**. Directly observed
on disk: `"IL"` and `"Ohio"`, `"IN"` and `"Indiana"`, `"KY"` and `"KENTUCKY"` (the last pair in
`similar-1.json`, which contains both `"SHEPHERDSVILLE, KY"` and `"SHEPHERDSVILLE, KENTUCKY"`).
`"FL"` / `"Florida"` was reported from the 2026-08-05 capture but **could not be checked here** —
no Florida record exists in the on-disk captures.

Stable alternatives if a non-geometric key is ever needed: `location.stopCode` (e.g. `"IGQ1"`),
`location.postalCode` (e.g. `"60428-4804"`).

### 6.4 One refresh can fire MULTIPLE /api/loadboard/search calls ❌ not verified here

Reported from the 2026-08-05 capture: with several saved-search tabs open, **two** search calls
fired together — one with `totalResultsSize: 104` (the active tab) and one with
`totalResultsSize: 11` and **`payout` null on every record** (a different tab).

**A consumer must select the response whose `workOpportunities[].id` values match the load-card
ids currently rendered — never simply the first response seen.** The join key for that check is
already proven: a card's inner `<div id="…">` equals `workOpportunities[].id` (STATE.md → JSON
reconnaissance).

**Not reproducible from the on-disk captures**, which are single responses. This is the finding
most likely to cause a subtle wrong-data bug and the least verified — **capture it before
building.**

### 6.5 Pagination still applies

`/search` paginates at **page size 50** (`paired-search.json`: `workOpportunities.length` 50,
`totalResultsSize` 338, `nextItemToken` 50). A 104-result multi-origin search therefore spans
**more than one page**. The DOM remains the source of truth for what is on screen.
