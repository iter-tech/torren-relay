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
- `payoutType` (UI state): `FLAT_RATE`

## 4. order-upsert — 53' Container and Chassis (captured 2026-07-14)

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
