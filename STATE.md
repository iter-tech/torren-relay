# Стан проекту
Оновлено: 2026-07-07 (Створення поста працює без запущеної петлі — on-demand Phase 1 parse)

## Поточна фаза
**Step 3 — Підключення контролів попапу до `chrome.storage.local`**

Базові стадії 0–13 повністю завершені. Зараз послідовно підключаємо кожен перемикач у popup до реального стану зберігання.

---

## Що завершено

### Стадії 0–13 (ядро системи)
- **Manifest MV3** + базова структура файлів
- **`utils/constants.js`** — `FORBIDDEN_SELECTORS`, `isForbiddenElement`, `ALLOWED_CLICK_INTENTS`
- **`utils/logger.js`** — `logger.log/warn/error/debug`
- **`utils/storage.js`** — async `storage.get/set/remove/getAll`, `STORAGE_KEYS`
- **`utils/tabState.js`** ✅ NEW — per-tab store `{ running, refreshIntervalMs, surgeThreshold, priceHistory }`. Pub/sub (`subscribe/notify`) synchronous. `set()` mirrors refreshIntervalMs/surgeThreshold/priceHistory to sessionStorage. `init()` async: restores sessionStorage, seeds surgeThreshold from global storage if absent.
- **`content/refreshManager.js`** — `findRefreshButton()`, `refreshNow()` — єдиний дозволений клік #1 (кнопка Refresh)
- **`content/loadParser.js`** — `parseLoads()`, `parseOneCard()` — Layout A
- **`content/loadDetector.js`** — `detectNewLoads()` — Set-based diff, перший запуск без спрацьовування
- **`content/highlighter.js`** — `highlightNewLoads()`, `clearHighlights()` — клас `.ext-new-load`
- **`content/detailOpener.js`** — `openTopNewLoad()` — єдиний дозволений клік #2 (neutral zone картки); `scrollIntoView` + `setTimeout(250)` для карток поза viewport
- **`content/inlinePanel.js`** — `showInlinePanel()`, `initManualToggle()` — розкладна таблиця зупинок нижче натиснутої картки; полінг `waitForSheet`; сегментований акордеон
- **`content/sidebar.js`** — `buildSidebar()` — фіксована панель зверху; play/pause pill; повзунок швидкості; анімація scanline (CSS-only). **Синхронізація через tabState pub/sub** (не onChanged). `chrome.storage.onChanged` для RUNNING/SPEED видалено. ~~`sidebar-surge-threshold`~~ видалено 2026-06-18 (tabState.surgeThreshold залишається, UI прибрано).
- **`content/loadObserver.js`** ✅ NEW (2026-06-18, fixed ×3, DIAG logs removed) — MutationObserver. **Anchor: `document.body`** `{ childList:true, subtree:true }`. `hasExternalChange()` filter: fires debounce for ANY non-ext childList mutation (class-name-agnostic). `isExtManagedNode()` guards surge badges + inline panel. `_pipelineRunning` flag prevents concurrent pipeline runs. Debounce 200ms. Same detect→highlight→sound→tabAlert→auto-open→auto-stop pipeline as tick. Standard logs only.
- **`content/panelCloser.js`** ✅ (2026-06-18) — `closePanelsForStart()`: закриває тільки detail sheet (`#selected-work-sheet`) при старті петлі. Лівий filter panel навмисно не чіпається (залишається відкритим якщо вже відкрито). `findDetailCloseButton()` + `isForbiddenElement()` перед кліком. Усі спроби закрити filter panel видалені 2026-06-18.
- **`content/inlinePanel.js`** — `initManualToggle()`: при ручному кліку на картку (`waitForSheet` callback) — тепер викликає `tabState.set('running', false)` (FIX 2, 2026-06-18) перед `showInlinePanel`. Зупиняє петлю тільки в цьому таб. Не торкається extension auto-open шляху. **Global stop numbers ✅ (2026-06-18):** `readSheetData()` призначає глобальні номери зупинок: сегмент N → `stops[0].num=N+1`, `stops[last].num=N+2`. `buildSegmentTable()` рендерить `.ext-stop-num` кружок коли `stop.num` не порожній. **Segment header rows ✅ (2026-06-18):** `buildPanelElement()` — `titleSpan` тепер береться з `stops[0].num` (а не `i+1`); у `destEl` додано `.ext-stop-num` кружок з `stops[last].num` перед кодом дестинації. Результат: рядок 0: `[1]` KILN → `[2]` DCM5; рядок 1: `[2]` DCM5 → `[3]` CMH1.
- **`content/content.js`** — оркестратор: підсвітка → звук → Tab Alert → авто-відкриття деталей → показ панелі → автостоп через `tabState.set('running', false)`. **Per-tab state ✅ (2026-06-18)**: `tabState.subscribe('running', fn)` замість onChanged; `scheduleNextTick()` — синхронна, читає tabState; init wrapped в async IIFE `await tabState.init()` перед buildSidebar. `closePanelsForStart()` викликається в subscriber при val=true. **Memory watchdog ВИДАЛЕНО (2026-06-30):** автоматичний `location.reload()` прибрано повністю — він непомітно скидав фільтри пошуку Amazon (Origin/Radius/Payout/Equipment), які живуть лише в React-стані, не в URL. Замінено на `getHeapUsageRatio()` — чисте читання `performance.memory`, без побічних дій.

### Step 3 — підключені контролі попапу
- **Night Mode ✅** — `content/nightMode.js`: CSS-клас `html.ext-night`. Ключ: `STORAGE_KEYS.NIGHT_MODE = 'nightMode'`.
- **Tab Alert ✅** — `content/tabAlert.js`: мигання заголовка + favicon (червоний/жовтий), тільки коли вкладка не у фокусі. Ключ: `STORAGE_KEYS.TAB_ALERT = 'tabAlert'`.
- **Hide Similar Matches ✅** — `content/filterSimilar.js`: CSS `:has()` ховає батьківський блок до рендеру. Ключ: `STORAGE_KEYS.HIDE_SIMILAR = 'hideSimilarMatches'`.
- **Auto-Open Top Load ✅** — `popup-auto-open` чекбокс. Ключ: `STORAGE_KEYS.AUTO_OPEN = 'autoOpenTopNew'`. True-default: `checked = data[KEY] !== false`. Контролює чи буде відкриватись найдохідніше нове навантаження.
- **Sound block ✅** — `content/soundAlert.js` + `popup/popup.js`: 25 звуків, volume slider, sound select, replay button. Persists `soundVolume` + `soundId`.
- **Hide tag filters ✅** — `content/filterTags.js`: Promoted / Starting soon / Trailer ready / Booked before. `display:none` на badge елементах (простір колапсується). `recomputeWrappers()` ховає `.wo-tag` wrapper якщо всі відомі дочірні теги приховані. Ключі: `hidePromoted`, `hideStartingSoon`, `hideTrailerReady`, `hidePastBook`.
- **Price Surge Alert ✅** — `content/priceSurge.js`: `checkPriceSurge(loads)` кожен тік. Тригер тільки на зростання payout >= threshold. `.ext-surge-price` + `↑ +$NN` badge. **Per-tab ✅**: threshold + priceHistory в tabState; тільки `surgeEnabled` залишається в chrome.storage.local. Sidebar `sidebar-surge-threshold` — per-tab override.

### Inline panel — візуальне доведення ✅
- Грід: `40px minmax(0,3fr) 1.4fr 1fr 1fr 32px`. Route-колонка: inner 3-column grid `1fr auto 1fr`. Plain text для Loaded/Empty/Drop/Live.

### ext-action-map wired ✅ DONE (2026-06-30)
Click → `openRouteInMaps(data)` → collects unique stops from `data.segments` (dedup by `stop.num`; boundary stops shared between adjacent segments counted once) → builds Google Maps Directions URL: `origin`=stop[0], `destination`=stop[last], `waypoints`=intermediate stops joined by `|` (omitted when only 2 stops). Each stop encoded as `stop.name + ' ' + stop.address` via `encodeURIComponent`. Opens via `window.open(_blank, noopener,noreferrer)`. Handler lives in `showInlinePanel()` where `data` is in scope. No new permissions, no new dependencies.

### ext-action-camera wired ✅ DONE (2026-06-30)
Click → `html2canvas(cardElement)` → PNG blob → `navigator.clipboard.write()`. Success: green checkmark flash 1.1 s. Error: `logger.error()`. `vendor/html2canvas.min.js` v1.4.1 vendored (194 KB). `clipboardWrite` permission added to manifest.json. Handler lives in `showInlinePanel()` (where `cardElement` is in scope); `captureCardToClipboard()` + `flashActionSuccess()` are new functions.

### Card Action Bar ✅ DONE (2026-06-30)
Три кнопки-іконки в нижній частині кожної inline-панелі (`buildActionBar()`, `inlinePanel.js`). CSS: `.ext-action-bar` + `.ext-action-btn` (hover CSS). Testid: `ext-action-bar`, `ext-action-camera`, `ext-action-map`, `ext-action-post`. Поточний стан кнопок: `ext-action-camera` ✅ wired (screenshot → clipboard), `ext-action-map` ✅ wired (Google Maps route), `ext-action-post` — render-only, не підключено (майбутня фіча).

### Reset to Defaults ✅ DONE (2026-06-30)
`popup-reset` button повністю підключено. Клік → `chrome.storage.local.remove(Object.values(STORAGE_KEYS))` без підтвердження → скидає всі popup-контроли до документованих defaults в callback. `tabState`/sessionStorage не чіпається. Перестилізовано як muted text-link, bottom-left. Виявлено і виправлено баг у `chrome.storage.onChanged` (volume/soundId/surgeThreshold призначали `undefined` при видаленні ключів — тепер fallback до defaults). `utils/constants.js`, `utils/logger.js`, `utils/storage.js` додано до `popup.html` (для `STORAGE_KEYS` та `logger`). Деталі: CHANGELOG.md 2026-06-30.

### Manual memory indicator ✅ DONE (2026-06-30)
Замінено автоматичний memory-watchdog reload на ручний індикатор у sidebar. `content/sidebar.js`: `ext-memory-indicator` — кольорова крапка (green ≤40% → amber ~62.5% → red ≥85%), оновлюється кожні 7с через `getHeapUsageRatio()` (content.js), незалежно від `tabState.running`. Клік/Enter/Space → `location.reload()` напряму — лише за ініціативою диспетчера, без жодного автоматичного тригера. `ext-memory-info` — іконка з tooltip (hover + tap/focus) що пояснює дію та попереджає про втрату фільтрів Amazon. Документовано в SAFETY.md як "Extension-owned click" — окрема категорія від трьох дозволених кліків по Amazon DOM. Деталі: CHANGELOG.md 2026-06-30.

---

### LoadUnit data model ✅ DONE (2026-06-30)
`utils/loadStore.js` — in-memory per-tab store (IIFE), not sessionStorage-backed. `mergeLoadUnit / getLoadUnit / pruneLoadUnits / getAllLoadUnits`. Loaded in manifest after `tabState.js`, before all content/ modules. Phase 1 wired in `loadParser.js` (per successfully parsed card + prune after loop). Phase 2 wired in `inlinePanel.js` (`showInlinePanel()`, after `readSheetData()` succeeds). `parseLoads()` and `showInlinePanel()` return values and external behavior unchanged — additive only. `priceSurge.js` untouched (Step 4 deferred). `searchContext` stays null (future work). `window.__EXT_DEBUG.getLoadUnits` exposed.

### ext-action-post wired ✅ DONE — Stage 14 (reworked 2026-07-07)
`content/patApi.js` + `content/patModal.js` — both fully rewritten to LoadFetcher parity. `inlinePanel.js` post button click → `openPostModal(sheetLoadId)` (unchanged). `manifest.json` load order unchanged. Equipment gate: "53' Trailer" only; other types → unsupported notice. Modal: origin/dest resolved from `boardStops` via API (static text, not user-editable), radii, time steppers (±15 min), stop count, min/max miles, $/mi + payout (linked via board distance), stem time, swing-door checkbox. Confirm → `buildPatPayload()` → `submitOrder()` POST to `/api/loadboard/orders/upsert` (confirmed path). City search API `/api/loadboard/filters/cities/search/<city>` confirmed path + response shape (`displayValue` always null — built manually). `PAT_TEST_MARKUP_USD = 5000` silent margin. Zero new `.click()` sites on Amazon DOM.

## Що в роботі
Нічого активного. Чотири bug-fix passes + design system + Stage 14 завершені:
- Core loop (7 виправлень): tabState no-op, подвійний старт, спільний пайплайн, ре-арм observer, захист prune, isExtManagedNode, heap log.
- inlinePanel.js (5 виправлень): stale-sheet fingerprint, currentPanelCard ownership, stop numbering counter, drift alarm, flashActionSuccess null title.
- Click pipeline (5 виправлень): highest-paying auto-open (sortByPayoutDesc), detach guard in 250ms settle, nested card dedup, panelCloser Strategy 2 tightened, stale click-site comments.
- Popup / sidebar / sound (6 виправлень): Auto-Open popup toggle, shared soundDefs.js, toggleRunning tabState fix, logger discipline, priceSurge null-parent guard, log-noise + isForbiddenElement hardening.
- **Design system ✅ (2026-07-06)**: `utils/designTokens.js` (new) + `popup/popup.css` (full rewrite) + `content/sidebar.js`, `content/inlinePanel.js`, `content/highlighter.js`, `content/priceSurge.js`, `popup/popup.js`. Blue accent (#1a73e8/#4c8dff), neutral scale n100–n900, dark mode via `html.ext-night` CSS vars. STYLING ONLY — zero behavior changes.
- **Sidebar dark mode fix ✅ (2026-07-06)**: `content/nightMode.js` stale green `!important` rules replaced with correct dark neutral surface (#1c1f24) + blue scanline + dark pill. `content/sidebar.js` explicit `html.ext-night #ext-sidebar` dark override block added. All `.js`/`.css` files clean of legacy green except `NIGHT_HEADER` (Amazon's native header, intentional).
- **Elevation dark theme ✅ (2026-07-06)**: `content/nightMode.js` full rework — 4-level surface ramp (base/raised/overlay/high), neutral gray text scale, green removed from all constants. Inline panel override block added (seg-header HIGH, stop-num accent, loaded/empty/dot/action-bar). `content/priceSurge.js` dark `!important` gaps fixed. Uncovered blocks noted: left filter panel (inherits base, acceptable), card hover.
- **PAT Modal rework ✅ (2026-07-07)**: `content/patApi.js` + `content/patModal.js` fully rewritten. LoadFetcher-parity form. Correct data mapping (`payoutNum`, `boardStops`, confirmed API paths). Stage 14 complete.
- **PAT on-demand Phase 1 parse ✅ (2026-07-07)**: `content/inlinePanel.js` post button handler now calls `parseOneCard(cardElement)` + `loadStore.mergeLoadUnit(…)` when LoadUnit Phase 1 is missing (loop was never started). Standalone-safe: zero side effects on detection pipeline. `content/patModal.js` equipment gate now shows "Could not read load data" for empty equipment (vs "unsupported" for a known non-53' value).

---

## Що далі (1–2 кроки)

1. **Live test PAT — no-loop path** — на свіжо завантаженій сторінці, без натискання Play, відкрий картку вручну та клікни Create Post. Очікувано: форма відкривається з повними даними (equipment, payout, boardStops заповнені через on-demand parse). Дивись TC-PAT-1 у TEST_CASES.md.
2. **Auto-restore Amazon filters after reload** (PLANNED, не розпочато) — потребує SAFETY.md review перед стартом, бо вимагає нових click/input сайтів на Amazon DOM (фільтр-панель). Div. BACKLOG.md.

---

## Блокери / важливі рішення

- **Amazon filters not restorable automatically**: search filters (Origin/Radius/Payout/Equipment) живуть лише в React-стані Amazon, не в URL — втрачаються при будь-якому ручному reload. Авто-відновлення — окрема майбутня фіча, потребує нових кліків на Amazon DOM та SAFETY.md review.
