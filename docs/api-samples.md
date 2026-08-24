# Amazon Relay API samples (real captured payloads)

> ## 🔴 11. THE P / R BADGE CANNOT BE DETERMINED FROM THE RESPONSE BODIES (2026-08-19, final)
>
> ### 11a. E1 — THE REQUEST SIDE IS NOT CAPTURED AT ALL
>
> `content/networkObserver.js` wraps `window.fetch` and reads `arguments[1]` (`init`) **only
> for `.signal`**. It never touches `init.body` or `init.method`, and no request payload,
> URL query string or filter selection is stored anywhere.
>
> **And the response does not echo the request.** Every top-level key was enumerated:
> `workOpportunities`, `totalResultsSize`, `nextItemToken`, `searchAuditId`, `isBotRequest`,
> `metadata`, `carrierDetails`. `metadata` is a CARB compliance warning; `carrierDetails` is
> account-level scoring, **byte-identical across all seven captures**. Neither carries the
> equipment filter.
>
> **To answer E1 properly would need the `/search` REQUEST body captured** — a change to
> `networkObserver.js` to record `init.body` for watched paths.
>
> ### 11b. 🔑 E1 COROLLARY — the record CANNOT encode the variant
>
> Amazon's own filter chips read **"53' Trailer (R)"** and **"53' Container (R)"** — the P/R marker
> is attached to the **equipment filter option**. But every record serialises **both** variants to
> the **same** enum: `loads[].equipmentType` is only ever `FIFTY_THREE_FOOT_TRUCK` (215) or
> `FIFTY_THREE_FOOT_CONTAINER` (15). **A "53' Trailer (P)" load and a "53' Trailer (R)" load are
> indistinguishable in `equipmentType`.**
>
> ### 11c. E2 — THE LABELLED SET IS 1 P, 0 R, AND THAT IS THE BLOCKER
>
> | label | in a capture? |
> |---|---|
> | `72e5184e` = **P** (badge read from `paired-card.html`) | ✅ yes |
> | `4c0565e4` = **P** (Ihor, live) | ❌ no |
> | COLUMBUS,IN → GROVEPORT,OH = **R** (Ihor, live) | ❌ no |
> | TOTOWA,NJ → HAZLETON,PA = **R** (Ihor, live) | ❌ no |
>
> Only **one** captured card file exists (`paired-card.html`), so exactly **one** record inside the
> captures has a known badge, and it is a P.
>
> ⚠ **With zero labelled R records inside the captures, no field can ever be CONFIRMED** — a rule is
> only confirmed by showing it separates a known P from a known R. Fields can only be **refuted**,
> and only when they split two known-Ps apart or contradict the board. That is exactly how
> `assetOwner`, `containerOwner`, C1 and C5 all died: **by refutation, never by confirmation.**
>
> **Measured vacuity: 83 fields vary across the 146 records; 63 of them are consistent with the one
> labelled P.** A test with one positive label and no negatives cannot narrow 63 candidates.
> Enumerating more fields is not a path to an answer.
>
> ### 11d. ✅ THE HONEST FINDING
>
> **The captured response bodies cannot answer this.** The badge is a property of Amazon's
> equipment-filter *option*, the request that carries that option is not captured, and the response
> collapses both variants onto one enum. This is not "we have not looked hard enough" — it is
> structural.
>
> **What Amazon itself marks is in the DOM**, and the extension already reads it:
> `div.trailer-type-circle > p` → `content/loadParser.js:84` → `trailerLetter` → `loadStore`.
> See §10a.

> ## 🔑 10. THE P / R BADGE — where it is rendered, and what has been ruled out (2026-08-19)
>
> Labelled evidence: `samples/pr-badge-labelled-records-2026-08-19.json`.
>
> ### 10a. THE BADGE IN THE DOM — and the extension already reads it
>
> From `samples/paired-card.html`, verbatim:
>
> ```html
> <span class="css-1maqsxd equipment-type-text"><span>53' Trailer </span></span>
> <div class="trailer-type-circle"><p class="css-nnltzv">P</p></div>
> …
> <span class="css-1maqsxd loading-type" title="Drop">Drop</span>
> ```
>
> **The badge letter is the `<p>` inside `div.trailer-type-circle`** — a **stable semantic
> class**, not a `css-<hash>`. `content/loadParser.js:84` already reads it into
> `trailerLetter`, and `loadStore` already carries it.
>
> ⚠ **This is evidence, not the fix.** PAT posts from one id plus one API record; the badge will
> not be read from the DOM in production. It is here to tell us what Amazon itself marks.
>
> ### 10b. 🔑 THE ONE FULLY-LABELLED PAIRING ON DISK
>
> The card above **is** work opportunity `72e5184e-7728-4c51-9562-5160c91d4132`, so its badge and
> its record are both known:
>
> | | |
> |---|---|
> | badge | **P** |
> | card "Loading Type" text | **Drop** |
> | record `stops[].loadingType` | **PRELOADED** |
> | record `stops[].unloadingType` | **DROP** |
> | `assetOwner` | AZNG |
> | `existingSubCarrierName` | AZNG |
>
> ### 10c. ❌ REFUTED — `trailerDetails[].assetOwner`. Do not re-derive.
>
> **Two records with a KNOWN P badge carry DIFFERENT values:**
> `72e5184e` = `"AZNG"`, `4c0565e4` = `"NCSL"` (Ihor confirmed the latter live).
> **A non-null or non-Amazon `assetOwner` does NOT mean carrier-owned, in either direction.**
> Separately, 42 of 159 work opportunities carry two different owners across their own stops, so
> there is no single value to read even in principle. **Tested and ruled out.**
>
> ### 10d. ❌ ALSO REFUTED — `containerOwner == "EMPTY_CONTAINER_ID"`
>
> `4c0565e4` (P) carries it; `72e5184e` (**also P**) does not. Two known-P records disagree.
> It appears in 64 of 146 work opportunities.
>
> ### 10e. ❌ CANNOT DISCRIMINATE — `stopRequirements[].stopRequirementType`
>
> `"CONTAINER"` in **146 of 146**. No variation at all.
>
> ### 10f. 🟡 SURVIVING HYPOTHESES — consistent with both known-P records, none confirmed
>
> Every field that varies across work opportunities was enumerated. Only these are consistent with
> **both** known-P records sitting on the P side:
>
> | # | hypothesis (would mean R) | loads it would call R |
> |---|---|---|
> | **C1** | any stop has `loadingType: "LIVE"` | **15 / 146** |
> | C2 | `existingSubCarrierName` is not purely `AZNG` | 29 / 146 |
> | C3 | any load has `isExternalLoad: true` | 24 / 146 |
> | C4 | equipment includes `FIFTY_THREE_FOOT_CONTAINER` | 15 / 146 |
>
> **C1 is ranked first, and it is the only one with a mechanism rather than a correlation:**
> a PRELOADED stop means the trailer is already loaded and waiting — Amazon supplied it; a LIVE
> stop means the trailer is loaded while the driver waits, which is what a carrier bringing its own
> trailer does. It also matches §8a exactly: the captured upserts tie `AMAZON_PROVIDED` to
> `loadingTypeList ["DROP"]` (7/7) and `CARRIER_OWNED` to `["LIVE"]` (4/4).
>
> **Half of C1 is already confirmed:** §10b is a *Drop / PRELOADED* card and its badge is **P**.
> The untested half is whether a *Live* card is **R**.
>
> ⚠ **All four remain HYPOTHESES until a load with a known badge confirms one.**

> ## 🔴 9. TRAILER OWNERSHIP IS NOT IN THE SEARCH RESPONSE (measured 2026-08-19)
>
> **The board shows a P / R badge per load and Amazon's own panel says "Provided" or "Required".
> Nothing in the captured `/api/loadboard/search` bodies carries that fact.**
>
> Measured across **159 work opportunities / 506 stops** in every capture on disk:
>
> | check | result |
> |---|---|
> | any path whose VALUE is `AMAZON_PROVIDED` or `CARRIER_OWNED` | **none, anywhere** |
> | any path whose value is a bare `"P"` or `"R"` | **none** |
> | `trailerDetails` in `projectRecord()` | not projected |
>
> ### 9a. The PLAN 29f candidate, verified: `loads[].stops[].trailerDetails[].assetOwner`
>
> It exists — an **array on each stop**, 253 entries across 506 stops. Every sibling field is
> **null in all 253**: `assetId`, `assetType`, `assetSource`, `dropTrailerETA`,
> `trailerLoadingStatus`. Only `assetOwner` is populated:
>
> `"AZNG"` ×164 · `"NCSL"` ×68 · `(null)` ×17 · `"HUBG"` ×3 · `"AZNU"` ×1
>
> ### 9b. 🔴 IT IS DISQUALIFIED, AND HERE IS THE MEASUREMENT THAT DISQUALIFIES IT
>
> **42 of 159 work opportunities carry MORE THAN ONE distinct `assetOwner` across their own
> stops** (e.g. `AZNG` + `NCSL` on the same load, 40 work opportunities). A post has exactly ONE
> trailer ownership, so a field that varies *within* a single load cannot be its source. There is
> no non-arbitrary rule for which stop wins.
>
> It is also the wrong KIND of value: `AZNG`/`NCSL`/`HUBG` are carrier or owner **codes**, not a
> provision flag. Mapping them by prefix — "AZN* means Amazon" — would be an **inference**, and it
> would set trailer ownership on **every** post.
>
> ### 9c. What is needed
>
> **The `/api/loadboard/search` response for a load whose card shows the R badge, and one showing
> P.** Comparing the two is the only way to find the discriminating field. Until then P/R stays
> unwired and every post carries `AMAZON_PROVIDED`.

> ## 🔑 8. ELEVEN CAPTURED UPSERTS — trailer ownership and equipment enums (2026-08-19)
>
> Captured by Ihor from the live Post-a-Truck form via **DevTools Offline** (built, never sent).
> Artefact: `samples/pat-upsert-eleven-2026-08-19.json`. ⚠ `samples/` is **gitignored** — this
> table is the durable copy.
>
> ### 8a. Trailer ownership — the only two values
>
> `providedTrailerType` and `visibleProvidedTrailerType` **always carry the SAME value**, one of:
>
> | value | captures | `loadingTypeList` in those captures |
> |---|---|---|
> | `"AMAZON_PROVIDED"` | 7 | **`["DROP"]` in all 7** |
> | `"CARRIER_OWNED"` | 4 | **`["LIVE"]` in all 4** |
>
> ### 8b. Equipment enums, by ownership
>
> **AMAZON_PROVIDED (7):** `FIFTY_THREE_FOOT_TRUCK` ⚠, `TWENTY_FOOT_CONTAINER`,
> `FORTY_FOOT_CONTAINER`, `FORTY_FIVE_FOOT_CONTAINER`, `FORTY_FOOT_HIGHCUBE_CONTAINER`,
> `FORTY_FIVE_FOOT_HIGHCUBE_CONTAINER`, `FIFTY_THREE_FOOT_CONTAINER`
>
> **CARRIER_OWNED (4):** `TWENTY_SIX_FOOT_BOX_TRUCK`, `CUBE_TRUCK`,
> `FIFTY_THREE_FOOT_CONTAINER`, `FIFTY_THREE_FOOT_TRUCK` ⚠
>
> ### ✅ THE 53' TRAILER ARRAY IS NOW FULLY CAPTURED (2026-08-19) — gap closed
>
> Expanded in DevTools, captured **twice**, once per order type. Artefact:
> `samples/pat-upsert-53ft-expanded-2026-08-19.json`.
>
> ```json
> "equipmentTypes": [
>   "FIFTY_THREE_FOOT_TRUCK",
>   "SKIRTED_FIFTY_THREE_FOOT_TRUCK",
>   "FIFTY_THREE_FOOT_DRY_VAN",
>   "FIFTY_THREE_FOOT_A5_AIR_TRAILER",
>   "FORTY_FIVE_FOOT_TRUCK"
> ],
> "visibleEquipmentTypes": "FIFTY_THREE_FOOT_TRUCK"
> ```
>
> **Exactly five elements, and IDENTICAL for both order types.** Power only (AMAZON_PROVIDED) and
> Tractor & Trailer (CARRIER_OWNED) send the same array for 53' Trailer — only
> `providedTrailerType` / `visibleProvidedTrailerType` differ.
>
> 🔑 **This is byte-identical to `PAT_EQUIPMENT_TYPES_53` in `content/patApi.js`**, captured
> 2026-07-14 (§3) — same five values, same order. **The July constant is independently
> re-confirmed** and the doubt raised in BACKLOG 0r is resolved: no change was needed.
>
> ⚠ **SHAPE LESSON.** One UI choice expands to SEVERAL enum values, so `equipmentTypes` is **not**
> a one-to-one mapping from the record's equipment field. Any mapping must be able to return a
> multi-element array — `PAT_EQUIPMENT_BY_ENUM` returns the array itself, so it already can.
>
> ### 8c. Shapes and constants seen in every capture
>
> `equipmentTypes` is an **ARRAY**; `visibleEquipmentTypes` is a **STRING** carrying the
> first/primary enum. Both are sent. Also: `payoutType: "FLAT_RATE"`,
> `distanceOrDuration: "DISTANCE"`, `excludeSpecialServices: ["SWING_DOOR"]`.
> `runType` was `"ONE_WAY"` or `"ROUND_TRIP"` — PAT's handling of it is unchanged.
>
> ### 8d. 🔑 WHY the loading type tracks ownership — UI finding
>
> From Ihor's screenshots: the **"Load" control (Drop & Hook / Live or Drop & Hook) exists ONLY
> under the "Power only" order type.** Box truck and Tractor & Trailer have **no Load section at
> all**. So `LIVE` is not *chosen* for carrier-owned posts — **it is what the form always sends
> for them.** The loading type is a consequence of the order type, not a free choice.

> ## 🔑 7. CAPTURED UPSERT — Team / 26' Box Truck / carrier-owned (2026-08-19)
>
> **Captured by Ihor from the live Post-a-Truck form using DevTools Offline** — the request was
> built by the form but never sent. Artefacts: `samples/pat-upsert-team-26ft-carrier-owned.json`
> and `samples/pat-upsert-loading-type-control.json`. ⚠ `samples/` is **gitignored**, so the
> values are recorded here as the durable copy.
>
> ⚠ **PARTIAL.** Only the fields quoted below were captured. Anything absent is still unknown —
> absence is not evidence.
>
> ```json
> "driverTypes":                ["TEAM"],
> "equipmentTypes":             ["TWENTY_SIX_FOOT_BOX_TRUCK"],
> "visibleEquipmentTypes":      "TWENTY_SIX_FOOT_BOX_TRUCK",
> "providedTrailerType":        "CARRIER_OWNED",
> "visibleProvidedTrailerType": "CARRIER_OWNED",
> "loadingTypeList":            ["LIVE"],
> "payoutType":                 "FLAT_RATE",
> "runType":                    "ONE_WAY",
> "distanceOrDuration":         "DISTANCE",
> "excludeSpecialServices":     ["SWING_DOOR"]
> ```
>
> ### 7a. The Load control, isolated (second capture, same method)
>
> | form option | `loadingTypeList` |
> |---|---|
> | **Live or Drop & Hook** | **`["LIVE"]`** |
> | Drop & Hook | `["DROP"]` |
>
> 🔑 **In THIS API `["LIVE"]` IS the wider "Live or Drop & Hook" option.** `["LIVE","DROP"]` has
> **never** been observed and must not be sent. The extension was sending exactly that pair, from
> an inference; it now sends `["LIVE"]`.
>
> ### 7b. ⚠ THIS CAPTURE CONTRADICTS §3's "do not send" list
>
> §3 lists `visibleEquipmentTypes`, `visibleProvidedTrailerType`, `distanceOrDuration` and
> `payoutType` as *"UI-only fields seen in page state but NOT in the POST body (do not send)"*.
> **This capture is the outgoing request body and contains all four.** The newer capture wins: it
> is the actual request, not an inference about page state. §3's note is stale on those four.
>
> ### 7c. Shapes that matter
>
> `equipmentTypes` is an **ARRAY**; `visibleEquipmentTypes` is a **STRING** carrying the same
> value. Both are sent. The extension already does this
> (`visibleEquipmentTypes: formState.equipmentTypes[0]`).
>
> ### 7d. What is still NOT captured
>
> - the `providedTrailerType` value for an **Amazon-provided (P)** trailer — but see §3, which
>   captured `"AMAZON_PROVIDED"` in a real payload, so **P is capture-backed after all**;
> - `FORTY_FOOT_CONTAINER` in any upsert — **stays unmapped**;
> - anything that would let the RECORD say whether a load is P or R. **That, not the constants, is
>   what blocks BACKLOG 0n.**

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

## 5.8 EQUIPMENT fields — every observed value, and what drives Amazon's own text ✅ 2026-08-17

Enumerated across **all six captures on disk — 159 records, 506 stops.** These are the *only*
values that exist; anything else must render as an em dash, never a guessed label.

### `workOpportunities[].loads[i].equipmentType`

| value | count | our label |
|---|---|---|
| `FIFTY_THREE_FOOT_TRUCK` | 235 | `53' Trailer` |
| `FIFTY_THREE_FOOT_CONTAINER` | 16 | `53' Container` |

### `workOpportunities[].loads[i].stops[j].loadingType` / `.unloadingType`

| field | values | counts |
|---|---|---|
| `loadingType` | `null`, `PRELOADED`, `LIVE` | 253 / 236 / 17 |
| `unloadingType` | `null`, `DROP`, `LIVE` | 253 / 226 / 27 |

A stop carries one or the other, never both.

### ⚠ `stops[j].trailerDetails[]` is USELESS for display

253 of 506 stops have one entry. In **every single entry**:

| field | value |
|---|---|
| `.assetId` | `null` — 253/253 |
| `.assetType` | `null` — 253/253 |
| `.assetSource` | `null` — 253/253 |
| `.trailerLoadingStatus` | `null` — 253/253 |
| `.dropTrailerETA` | `null` — 253/253 |
| `.assetOwner` | **populated**: `AZNG` 164, `NCSL` 68, `null` 17, `HUBG` 3, `AZNU` 1 |

`assetOwner` is the only readable field, and it is a carrier code, not a trailer id. **Do not
expect a trailer number from this endpoint** — the board does not send one.

### What drives Amazon's own "53' Trailer P" — ESTABLISHED, not inferred

`samples/paired-card.html` and `samples/paired-search.json` are a genuine pair: the card's
`div id` is `72e5184e-7728-4c51-9562-5160c91d4132`, and that id **is** in the response. Comparing
the two directly:

| Amazon's card renders | comes from |
|---|---|
| `53' Trailer` (`.equipment-type-text`) | `loads[0].equipmentType = FIFTY_THREE_FOOT_TRUCK` |
| `P` (`.trailer-type-circle`) | `stops[0].loadingType = PRELOADED` — the initial |

The equipment half of our label is therefore **character-identical** to Amazon's. The circle letter
is confirmed for `PRELOADED` on this one pairing only; `LIVE` and `DROP` have no captured card, so
we render the full word (`Preloaded` / `Live` / `Drop`) rather than invent `L` and `D`.

---

## 5.9 `/api/loadboard/recommendations/get` — the "Recently added" source ✅ confirmed 2026-08-13

**The endpoint we were missing.** Found in the Network tab and confirmed against its response body.

| | |
|---|---|
| **URL** | `https://relay.amazon.com/api/loadboard/recommendations/get` |
| **Method / type** | fetch |
| **Status / size** | 200, ~19 kB |
| **What renders from it** | the **"Recently added"** cards |

**Confirmed field paths — identical to `/search`:**

```
searchAuditId
workOpportunities[].id
workOpportunities[].loads[0].stops[0].location.latitude
workOpportunities[].loads[0].stops[0].location.longitude
workOpportunities[].loads[0].stops[0].stopType === "PICKUP"
```

Because `stops[0]` is the PICKUP here exactly as it is on `/search`, **the existing extractor
needs no special case** — the same `loads[0].stops[0].location` rule applies unchanged.

### ⚠ Why this mattered more than it looks

The observer was already **seeing** this request and discarding it, because `CAPTURE_PATHS` listed
only `/search` and `/similar`. The consequence was precise and bad: the **newest loads** — the ones
this extension exists to catch — were the ones whose ids reached assignment as strangers, logged as
`id never seen in any captured response`, left unassigned and therefore unfilterable and visible
under every city tab.

Added to `CAPTURE_PATHS` on 2026-08-13. **NOT added to `WATCH_PATH`**: rate-limit reporting stays
search-only, or recommendations failures would start driving `background.js`'s backoff.

**Labelled `recommendations`** in `CITY ENDPOINT SHAPE` and `CITY MERGE`, so the three sources stay
distinguishable in the console. Assignment itself is endpoint-blind — the ids and coordinates merge
into the same `id -> {lat,lng}` map as everything else.

**Still unknown, do not assume:** whether this endpoint paginates, whether it fires on every
refresh or only on some, and whether its `searchAuditId` relates to the `/search` one. Nothing in
the code depends on any of those.

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

### 6.5 Pagination still applies — but the PAGE SIZE IS NOT FIXED ✅ corrected 2026-08-17

⚠ **This section used to claim "page size 50", and §6.7 used to claim "the live board now
paginates at 5". Both were over-generalised from a single capture, and they contradicted each
other.** Measured across every capture on disk:

| capture | records | `nextItemToken` | `totalResultsSize` |
|---|---|---|---|
| `paired-search` | 50 | 50 | 338 |
| `similar-1` | 50 | 50 | 232 |
| `search-5cities-active` | 50 | 50 | 104 |
| `search-5cities-other` | **5** | 5 | 11 |
| `search-2` | **4** | null | 4 |

**4, 5 and 50 have all been observed.** What IS stable, and safe to rely on:

- **one response carries ONE page, never several** — at most 50 records
- `nextItemToken` is a **cursor** equal to the records delivered so far, not a total
- `totalResultsSize` is the grand total across all pages
- a response with no more pages carries `nextItemToken: null`

**Never hardcode a page size.** Read the RENDERED range from the board's "Showing" line — see
§6.5b. The DOM remains the source of truth for what is on screen.

---

## 6.6 THE ID JOIN — CONFIRMED CORRECT ON A LIVE BOARD (2026-08-08) ✅

**Do not re-derive or re-guess this. It is confirmed from two directions.** A live run reported
0/50 matches and the join was assumed to be pointing at the wrong field; it was not, and no code
was changed. A later live run with diagnostics showed **20/20 captured ids matching**.

**The corresponding pair, exactly:**

| Side | Exact read |
|---|---|
| **DOM** | `document.querySelector('div.load-list')` → `.querySelectorAll('div.load-card, div.load-card__selected, div.wo-card-header--highlighted')` → per card `.querySelector('div[id]')` → the **`.id` DOM property** of that **child** element |
| **JSON** | **`workOpportunities[].id`** |

Both are bare UUIDs, e.g. `72e5184e-7728-4c51-9562-5160c91d4132`. **No prefix, no suffix, no
colon segment, no wrapping token, no `data-*` involvement.**

**Evidence on disk, reproducible without a browser:**
- `samples/paired-card.html` → its `div[id]` is `72e5184e-7728-4c51-9562-5160c91d4132`
- `samples/paired-search.json` → that exact string is `workOpportunities[3].id`
- All 50 ids in `paired-search.json`, and all 50 in `search-5cities-active.json`, are bare UUIDs
  at `workOpportunities[].id`

**`workOpportunities[].loads[0].workOpportunityId` carries the IDENTICAL value** in every record
of both captures. It is a valid alternative path, **not** a different identifier — do not treat a
match there as evidence of a second id space.

### ⚠ Known fragility of the DOM side — `div[id]` is a weak selector

It takes the **first descendant with any id**, not "the load's id". The paired card also contains
`<div id="STARTING_SOON">` and `<div data-id="custom-tag-comp">`; the UUID div merely happens to
come first in document order. **If Amazon ever reorders these, or renders a card whose UUID div is
absent, every card would yield a tag name instead** — which would produce exactly the 0/50
signature seen once already, *and* would still pass a containment check, because `STARTING_SOON`
appears in the response body under `tags[]`. If that symptom returns, check this before
suspecting the JSON path. Harden by selecting the UUID-shaped id rather than the first one.

---

## 6.8 HOW the board's `/search` body must be captured (2026-08-13) ✅ proven live

> **See also §6.9 — the /search REQUEST.** §6.8 is about the RESPONSE and is unchanged by it.

**The board reads its own response via `Response.json()`, and that read completes. A cloned read
of the same response CANNOT be made to work.**

**Why cloning fails.** Amazon's SPA aborts its own in-flight search on every refresh
(`onAutoRefresh → executeAvailableWorkFilterActions`). `resp.clone()` succeeds and tees the body,
but `AbortController.abort()` **errors both branches of a tee regardless of what is already
buffered**. The result: `AbortError` on exactly the response that renders the active board, every
cycle. Reading earlier does not help — the abort lands milliseconds later, not microseconds.
Salvaging buffered chunks does not help — queued chunks are discarded when the stream errors.

**Proven by console experiment (2026-08-13), same response, same refresh:**

```
[PEEK] json() OK      /api/loadboard/search  wo: 1  total: 1     <- Amazon's read: SUCCEEDS
[PEEK] text() FAILED  /api/loadboard/search  AbortError          <- our clone read: DIES
```

**The working approach:** wrap `Response.prototype.json` / `.text`, call the original, and
**return its promise object unchanged**, observing on a separate branch. Abort-after-read is
harmless to Amazon, so their read completes and we see the same parsed object.

**Two consequences for anyone reading these captures:**
- **`.json()` yields an already-parsed object — there is no raw body string.** Do not
  re-stringify it to reuse a string code path; on a ~300 KB response that costs more than the
  capture. Any diagnostic needing raw text (substring/containment checks) is unavailable on this
  path and must report *unknown*, never a false negative.
- **One refresh fires several `/search` calls.** Observed: 4 requests, of which one is canceled,
  one is the active board, and the others belong to other saved-search tabs (`woCount 0`). The
  request **path plus `totalResultsSize`** is what identifies which tab a response came from.

Reference implementation: `installResponseReadHook()` in `content/networkObserver.js`.

---

## 6.7 The page ACCUMULATOR and its reset rule (2026-08-08)

**Model.** `content/cityAssign.js` keeps `id -> { lat, lng, city }` for every `/search` page seen
during one search session. Pages are **merged**, not replaced; a repeated id **overwrites** with
the newest coordinates. **Never stores a response body.** 215 bytes/entry measured; capped at
3000 entries (~629 KB), oldest-out.

**Why it was thought to be needed:** this section claimed `/search` serves **5 loads per page**
and that §6.5's "page size 50" was stale. ⚠ **Both claims were wrong** — see the corrected §6.5:
the page size is not fixed (4, 5 and 50 all observed), so neither number generalises.

The underlying concern was real, though, and was solved differently: a fixed handful of buffers
covered only part of the rendered list. The answer was **not** an accumulator but a **merged,
persistent `id -> {lat,lng}` map** fed by every buffered response and bounded at 4000 entries —
see PLAN 7e. Merging is safe because the work-opportunity id is globally unique: measured across
the captures, **13 ids appear in more than one response, 13 with identical coordinates, 0
conflicts.**

**Reset rule — one search session = one accumulator.** Checked on each arriving response
**before** the merge, so the page that announces a new search is kept:

| Signal | Status |
|---|---|
| `$.searchAuditId` changes between responses | **Default**, per instruction. ⚠ **Reliability NOT established** — see below |
| Active origin-city set changes (from `originCities.js`) | Unambiguous: the dispatcher edited the search |

### ⚠ What is NOT known about `searchAuditId` — do not assume it

- It is **one opaque UUID per RESPONSE** (§2). Whether it stays **stable across PAGES of the same
  search** has **never been observed**. Every sample in `samples/` is page 1 of a *different*
  search — there is no two-page capture of one search to compare. **If it is per-request, using
  it as a reset key clears the accumulator on every page and coverage never climbs.**
- **It is NOT shared between saved-search tabs.** Proven: `search-5cities-active.json`
  (`d4086e61-…`) and `search-5cities-other.json` (`97b3f387-…`) came from the *same refresh* and
  share **zero** work-opportunity ids. So with two saved-search tabs open, each response resets
  the other's accumulator and coverage collapses.

**If either symptom shows up live**, the fix direction is to bucket the accumulator *by*
`searchAuditId` and assign from the union, rather than using it as a global clear — that survives
both the per-page case and the two-tab case. Deliberately not built until the live log says which
is happening.

---

## 7. Pickup-coordinate city assignment — IMPLEMENTED as a read-only debug step (2026-08-06)

**Status: built, flag-gated OFF, and AWAITING LIVE CONFIRMATION.** The findings in §6 are now
consumed by real code — `content/cityAssign.js` — but that code has **never been run against a
live board**. Nothing acts on its output; it only logs. Treat the assignment as *unproven* until
the per-city counts have been read from a real console and matched against what the dispatcher
sees on screen.

**What is consumed, and from where:**

| §6 finding | How `cityAssign.js` uses it |
|---|---|
| §6.1 pickup lat/lng present on `loads[0].stops[0].location` | Extracted in the MAIN world into `{id, lat, lng}` triples by `emitCityAssignCoords()` in `networkObserver.js`, posted as `__extRelayCityCoords` |
| §6.2 join key: card's inner `<div id>` = `workOpportunities[].id` | The lookup key for every card |
| §6.3 state formatting inconsistent within one response | **Why the assignment is geometric.** No city or state string is compared anywhere in `cityAssign.js` — nearest city by haversine only |
| §6.4 one refresh can deliver multiple `/search` responses | `pickBuffer()` keeps the last 4 and chooses the one with the **largest id intersection** with the cards rendered, logging every buffer's count so a wrong pick is visible. **§6.4 itself is still unverified** — this code is written to survive it either way |
| §6.5 pagination at 50 | The DOM is the source of truth: only ids actually rendered are assigned. Ids in the response but not on screen are simply not counted |

**No origin-attribution field exists in the response** (established 2026-08-05) — geometry is not
a preference here, it is the only available method.

**Loads with no usable coordinates are reported, not silently dropped.** The emitter sends a
separate `noCoordIds` list, so the unmatched log can state the real reason (`no coord in JSON`
vs `id not in any response`) instead of guessing. All 50/50 records in the on-disk capture had
coordinates populated, so this path is **expected to stay empty** — if it does not, that is a
finding worth chasing.

**Distance threshold `150 mi` is a GUESS**, not a captured value — see CHANGELOG 2026-08-06.
Beyond it a card is counted unmatched rather than forced onto a city. Tune against real logs.

**Coordinates for the origin cities themselves** come from the same cities endpoint documented in
§1/§2 (`name`, `stateCode`, `latitude`, `longitude`), via `resolvePATCity()`. Note that function
is **not memoised** — `cityAssign.js` caches its results per page session precisely so this does
not become a per-refresh network call.

## 6.9 The `/search` REQUEST body — where the dispatcher's RADIUS lives (2026-08-20) ✅ captured live

Ihor captured the request body from DevTools on 2026-08-20. **The radius is in the REQUEST, and
it is PER CITY.**

```
originCitiesRadiusFilters: [
  { cityLatitude: 41.837235, cityLongitude: -87.685969,
    cityName: "CHICAGO", cityStateCode: "IL", ... },   <- entry truncated in the paste
  ...
]
startCityRadius: 75
originCities: [ { name, stateCode, country, latitude, longitude, ... }, ... ]
resultSize: 50
maximumNumberOfStops: 4
minPayout: 400
minPricePerDistance: 4
isAutoRefreshCall: true
savedSearchId: "6dc8cde0-b75e-4031-93fd-e4002c09cf10"
```

⚠ **THE RADIUS FIELD NAME INSIDE EACH ENTRY IS NOT YET KNOWN** — the paste truncates the entry.
**Do not guess it, and do not assume its unit.** `content/networkObserver.js` projects those
entries **by SHAPE, not by name** precisely so the capture reveals the name without anyone
inventing one.

⚠ **CORRECTION to an assumption we had been working under.** "The same radius for all cities in
the search" is **not** what the API stores — it stores a radius **per city**. The UI may well set
them alike; build from the request, not from the assumption.

### It is a plain object, not a stream

🔑 **This is why §6.8's hazard does not apply here.** The abort-kills-both-tee-branches problem
is a property of response **streams**. The request body arrives as `init.body`, already a string
in hand — **no clone, no tee, no abort exposure.** If the call shape is ever
`fetch(new Request(...))` instead, the body is a stream on the Request and the capture **STOPS
and reports**; it does not clone. See `classifyRequestBody()`.

🔑 **§6.8 IS UNTOUCHED.** `installResponseReadHook()` and the `Response.prototype.json`
piggyback are not modified by this. Request capture sits **beside** them in the `window.fetch`
wrapper, which already received `arguments[1]` and read `init.signal`.

### What is carried across postMessage, and what is not

| kept | why |
|---|---|
| `originCitiesRadiusFilters[]` | the point of the exercise — the per-city radius. Projected **by shape**: scalars and `{value, unit}` pairs only |
| `originCities[]` | needed to match a radius entry to an active origin city. Strict **name** allow-list (`name`, `stateCode`, `country`, `latitude`, `longitude`) — those names ARE known |
| `startCityRadius` | a named scalar radius sitting beside them |

| dropped | why |
|---|---|
| `savedSearchId` | an identifier for the dispatcher's saved search |
| `minPayout`, `minPricePerDistance` | his commercial settings — none of our business |
| `resultSize`, `maximumNumberOfStops`, `isAutoRefreshCall` | not needed for membership |
| anything matching `/token|secret|auth|csrf|session|cookie|password|jwt|bearer|signature/i` | checked **before** the shape allow-list, so a credential cannot ride in on a scalar |
| nested objects, arrays, strings > 64 chars | an audit blob cannot ride along |

### How to save one

`samples/` is gitignored, so the file must be written by hand:

1. Load the board with the loop running.
2. In the page console: `__EXT_DEBUG.dumpSearchRequest()`
3. Paste the printed JSON into `samples/search-request-2026-08-20.json`.

⚠ **The capture is deliberately the PROJECTED object, not the raw body** — the raw body carries
`savedSearchId` and the dispatcher's payout thresholds, and there is no reason for those to sit
on disk.

### 6.9.1 The radius field — CONFIRMED 2026-08-20

Each `originCitiesRadiusFilters` entry has **exactly six fields**:

```json
{ "cityDisplayValue": "CHICAGO, IL",
  "cityLatitude": 41.837235,
  "cityLongitude": -87.685969,
  "cityName": "CHICAGO",
  "cityStateCode": "IL",
  "radius": 75 }
```

Live capture in `samples/search-request-2026-08-20.json`: five cities, `rawFilterKeyCounts`
`[6,6,6,6,6]` — **no field lost in projection** — all reading `radius: 100`. An earlier capture
the same day read 75, so the capture tracks the dispatcher's current setting, not a stale one.

#### 🔴 THE UNIT IS IMPLICIT — a KNOWN LIMITATION, not an oversight

`radius` is a **bare number**. Every other distance in this API is `{ value, unit }` —
`deadhead`, `totalDistance`, per-load `distance` all carry `"miles"`; the PAT upsert carries
`"mi"`. **This one carries nothing.**

Every capture on disk is from a **`.com`** board, where miles is overwhelmingly the meaning, and
our maths is miles. **But nothing in the payload says so.** On a metric Relay domain the number
would mean kilometres and every range would be **~38% short** — loads would silently vanish from
their city tabs. `radiusUnitCaveat()` appends a warning to every diagnostic line that quotes a
radius when the host is not `relay.amazon.com`, and **no conversion is ever performed**.

⚠ **An unknown host says nothing rather than the wrong thing** — an empty hostname is "we do not
know", not "non-.com".

**To close this properly a non-`.com` capture is needed** — the same one PLAN 21 (non-US locale)
already requires.

#### Matching is on COORDINATES

Entries are joined to our active origin cities by **haversine distance**, not by name or country:

1. **Name is localised copy.** Our city strings come from Amazon's chips (`"CHICAGO, IL"`); the
   entry carries `cityName` and `cityStateCode` separately, so a name match means re-assembling
   and re-parsing a string across 11 locales.
2. ⚠ **Country is not reliable** — in the live capture **TULSA carries `country: null`** while
   the other four carry `"US"`.
3. Coordinates are what the membership maths already uses.

⚠ **THE TWO COORDINATE SOURCES DO NOT AGREE EXACTLY.** Our resolved city comes from the CITIES
endpoint; the entry carries its own. The live capture has CHICAGO at `41.837235,-87.685969`
while the cities endpoint answers `41.8781,-87.6298` — **about 4 mi apart**. The match bound is
therefore **15 miles**, comfortably above that gap and far below the distance between two
distinct selected cities (the closest realistic pair, CHICAGO/JOLIET, is ~35 mi). An **ambiguous**
match — two entries inside the bound — is **refused**, not guessed.

## 6.10 TWO SHAPES OF STOP — facility-level and CITY-LEVEL (2026-08-24) 🔴

⚠ **This supersedes the 2026-08-21 reading that the problem belonged to `/similar`.** The endpoint
is **not** the variable. Both shapes occur **in the same response**, from any endpoint.

### The two shapes

**FACILITY-LEVEL — an Amazon building. HAS coordinates:**
```json
{ "label": "UNC3", "stopCode": "UNC3", "line1": "4525 STATESVILLE RD",
  "postalCode": "28269", "latitude": 35.2821767, "longitude": -80.8358462 }
```

**CITY-LEVEL — a vendor/city pickup. NO coordinates:**
```json
{ "label": "LOCKBOURNE, OH", "stopCode": null, "line1": null,
  "postalCode": null, "latitude": null, "longitude": null,
  "city": "LOCKBOURNE", "state": "OH", "timeZone": "America/New_York" }
```

### Measured across every capture on disk — 159 records, 506 stops

| measurement | result |
|---|---|
| city-level stops (null latitude) | **47 of 506 — 9.3%** |
| facility-level stops | 459 |
| 🔑 **null latitude WITHOUT stopCode/line1/postalCode/longitude also null** | **0 — the rule holds with no counter-example** |
| city-level stops with `city` null | **0** |
| city-level stops with `state` null | **0** |
| city-level stops with `timeZone` null | **0** |
| 🔑 `label` === `city + ", " + state` | **47 / 47** |
| records with a **city-level FIRST stop** | **0 of 159** |

⚠ **THE LAST ROW IS WHY THIS WAS NEVER SEEN BEFORE.** Assignment reads
`loads[0].stops[0].location`, and in every capture we hold, stop 0 is always a facility. The
city-level stops are all later stops. **Ihor's 2026-08-24 board has a city-level FIRST stop, and
that is precisely what breaks assignment.**

### State spellings — THREE casings, on both shapes

`"OH"` (2-letter), `"Ohio"` (Title Case) and `"KENTUCKY"` / `"TEXAS"` (UPPER) all occur.
On the 47 city-level stops: **45 are 2-letter, 2 are full names** (`"Pennsylvania"`, `"Virginia"`).

⚠ **`resolvePATCity()` matches `results[i].stateCode === state` — a strict two-letter comparison —
and does NOT call `normalizeState()` on a pre-parsed `{city, state}` input.** A full state name
would therefore never match. See BACKLOG 0af.

### Intra-city facility spread — the accuracy budget for a city centroid

Measured over 27 cities that appear with more than one distinct facility:
**median spread 3.3 mi, maximum 18.8 mi** (JACKSONVILLE, FL — JAX9 vs JAX7).

### ⚠ THE 2026-08-24 BODY ITSELF IS NOT ON DISK

The two shapes above are quoted from Ihor's message, not read from a saved file. The eleven
city-level pickups he listed — LOCKBOURNE OH, HOBART WI, JACKSON TN, MEMPHIS TN, PALMETTO GA,
DEERFIELD WI, PERTH AMBOY NJ, ORISKANY NY, JEFFERSON CITY MO, OMAHA NE, ELWOOD KS — could not be
verified against a body. **To save it:** DevTools → Network → the `/api/loadboard/search` (or
whichever endpoint served those cards) → **Response** → save as
`samples/search-city-level-2026-08-24.json`. `samples/` is gitignored, so this must be done by
hand.

### 6.10.1 The capture is on disk, and the fix landed 2026-08-24

`samples/search-city-level-2026-08-24.json` — 8 work opportunities, saved by Ihor from the board
that failed. **Six of the eight have a city-level FIRST stop**: LOCKBOURNE OH, HOBART WI,
INDIANAPOLIS IN, DEERFIELD WI, PERTH AMBOY NJ, ORISKANY NY. The other two are facilities
(UNY5 Brooklyn NY, SRH2 Wilmington MA) and carry coordinates.

Measured on this file: **12 city-level stops, zero counter-examples** to the rule; `label` equals
`city + ", " + state` in **12/12**; **two carry a full state name** (`"Illinois"`, `"Ohio"`).

⚠ **All eight records are `loadType: "LOADED"`, which REFUTES the `EMPTY` correlation** seen in
the older captures. That correlation was an artefact of empty-leg repositioning stops and was
flagged as unproven when first reported.

**How it is now handled:** the MAIN world carries `{ id, city, state }` for a coordinate-less
stop; the isolated world resolves it through `resolveCityCoords()` — the same function that
resolves the dispatcher's own origin cities — after normalising the state through patApi's
`STATE_NAME_TO_CODE`. See CHANGELOG 2026-08-24.
