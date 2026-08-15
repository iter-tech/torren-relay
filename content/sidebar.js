function buildSidebar() {


  logger.log('sidebar', 'buildSidebar called');

  if (document.querySelector('[data-testid="ext-sidebar"]')) {
    logger.warn('sidebar', 'sidebar already present, skipping');
    return;
  }

  // Static CSS only — no page data, safe per CLAUDE.md rule 10
  const style = document.createElement('style');
  style.setAttribute('data-testid', 'ext-sidebar-styles');
  style.textContent =
    // 2026-07-30: was a single flex ROW (fixed height:40px). Now a flex COLUMN — row 1
    // (existing controls, unchanged) plus an optional row 2 (shared-rate status line,
    // ext-sidebar-row2 below), so the bar can grow by SIDEBAR_ROW2_HEIGHT (see sidebar.js)
    // when shared mode is on. height:auto (was a fixed 40px) so it sizes to whichever rows
    // are present; body{padding-top} is now set dynamically in JS (syncBodyPadding()) to
    // match, instead of the old hardcoded 44px.
    '#ext-sidebar{' +
      'position:fixed;top:0;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;background:var(--ext-bar-bg);color:var(--ext-n900);' +
      'display:flex;flex-direction:column;' +
      'border-radius:0 0 8px 8px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.14);' +
      'border-bottom:1px solid var(--ext-n200);' +
      'font-family:Arial,sans-serif;font-size:13px;font-weight:600;' +
      'letter-spacing:.3px;white-space:nowrap;user-select:none;' +
      // 2026-07-30: was overflow:hidden. Changed to visible because the info tooltip
      // (ext-memory-tooltip; ext-rate-limit-tooltip also existed then) is absolutely
      // positioned BELOW the bar and was being clipped away entirely by it. Nothing
      // depended on the clip: the
      // scanline has its own overflow:hidden (.ext-scanline), and the border-radius still
      // rounds the bar's own background regardless. position:fixed would not have escaped
      // it either — this element's transform makes it the containing block for fixed
      // descendants, so they are clipped by its overflow too.
      'overflow:visible;' +
      // Added for the paused banner, whose sentence was far longer than any other row-1
      // content: without a cap the auto-width bar would grow past the viewport on narrow
      // screens (it is centred, so it would run off BOTH edges). 2026-07-31: the banner is
      // gone, but this cap is KEPT deliberately — it is what bounds row 2's width so its
      // own overflow:hidden/text-overflow:ellipsis can actually trigger (that line grows
      // with the active-tab count), and removing a purely defensive cap is a layout change
      // that could not be tested here. Harmless when nothing is wide enough to hit it.
      'max-width:calc(100vw - 16px);' +
    '}' +
    '#ext-sidebar .ext-sidebar-row1{' +
      'height:40px;padding:0 20px;display:flex;align-items:center;gap:12px;' +
    '}' +
    // Row 2 — shared-rate status line (2026-07-20 toggle follow-up, 2026-07-30 this task).
    // Hidden by default (JS shows it only when shared mode is ON and backoff is not
    // active — see sidebar.js renderSharedRateStatus()). SIDEBAR_ROW2_HEIGHT in sidebar.js
    // must match this height (20px) — kept as two discrete states rather than a measured
    // getBoundingClientRect() so body padding can be set synchronously, no reflow timing.
    '#ext-sidebar [data-testid="ext-shared-rate-status"]{' +
      'display:none;height:20px;padding:0 20px 6px;margin-top:-4px;' +
      'font-size:11px;font-weight:400;letter-spacing:normal;color:var(--ext-n500);' +
      'overflow:hidden;text-overflow:ellipsis;' +
    '}' +
    '#ext-sidebar [data-testid="ext-sidebar-title"]{' +
      'font-size:13px;font-weight:600;color:var(--ext-n900);' +
    '}' +
    '#ext-sidebar [data-testid="ext-playpause"]{' +
      'width:48px;height:26px;border-radius:13px;' +
      'background:var(--ext-n100);border:1px solid var(--ext-n200);' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'cursor:pointer;color:var(--ext-n700);outline:none;' +
      'transition:background .15s,border-color .15s,color .15s;' +
    '}' +
    '#ext-sidebar [data-testid="ext-playpause"]:hover{' +
      'background:var(--ext-n200);border-color:var(--ext-n300);' +
    '}' +
    '#ext-sidebar [data-testid="ext-playpause"]:focus-visible{' +
      'box-shadow:0 0 0 2px var(--ext-accent);' +
    '}' +
    '#ext-sidebar[data-running="true"] [data-testid="ext-playpause"]{' +
      'background:var(--ext-accent);border-color:var(--ext-accent);color:#fff;' +
    '}' +
    '#ext-sidebar[data-running="true"] [data-testid="ext-playpause"]:hover{' +
      'background:var(--ext-accent-hover);border-color:var(--ext-accent-hover);' +
    '}' +
    '#ext-sidebar .ext-pp__icon{width:14px;height:14px;display:block;}' +
    '#ext-sidebar .ext-pp__pause{display:none;}' +
    '#ext-sidebar[data-running="true"] .ext-pp__play{display:none;}' +
    '#ext-sidebar[data-running="true"] .ext-pp__pause{display:block;}' +
    '#ext-sidebar .ext-scanline{' +
      'position:absolute;left:8px;right:8px;bottom:0;height:2px;' +
      'border-radius:2px;overflow:hidden;opacity:0;transition:opacity .2s;' +
      'pointer-events:none;' +
    '}' +
    '#ext-sidebar[data-running="true"] .ext-scanline{opacity:1;}' +
    '#ext-sidebar .ext-scanline__seg{' +
      'position:absolute;top:0;left:0;height:100%;width:38%;border-radius:2px;' +
      'background:linear-gradient(90deg,rgba(26,115,232,0),rgba(26,115,232,.9),rgba(26,115,232,0));' +
    '}' +
    '#ext-sidebar[data-running="true"] .ext-scanline__seg{' +
      'animation:extScan var(--ext-scan-dur) linear infinite;' +
    '}' +
    'html.ext-night #ext-sidebar .ext-scanline__seg{' +
      'background:linear-gradient(90deg,rgba(76,141,255,0),rgba(76,141,255,.9),rgba(76,141,255,0));' +
    '}' +
    '@keyframes extScan{' +
      '0%{transform:translateX(-110%)}' +
      '100%{transform:translateX(370%)}' +
    '}' +
    '@media (prefers-reduced-motion: reduce){' +
      '#ext-sidebar .ext-scanline__seg{animation:none!important;width:100%;' +
        'background:rgba(26,115,232,.9);}' +
      'html.ext-night #ext-sidebar .ext-scanline__seg{' +
        'background:rgba(76,141,255,.9);}' +
    '}' +
    '#ext-sidebar [data-testid="ext-slider-speed"]{' +
      'width:80px;cursor:pointer;accent-color:var(--ext-accent);vertical-align:middle;' +
    '}' +
    '#ext-sidebar [data-testid="ext-slider-value"]{' +
      'font-size:11px;min-width:28px;opacity:.9;color:var(--ext-n700);' +
    '}' +
    // 2026-07-31: the ext-rate-limit-banner / ext-rate-limit-text rules lived here and were
    // removed with the paused message. See BACKLOG.md "Sidebar paused/rate-limit message" for
    // the exact declarations, in case this is reinstated.
    '#ext-sidebar [data-testid="ext-memory-indicator"]{' +
      'width:12px;height:12px;border-radius:50%;cursor:pointer;' +
      'border:1px solid var(--ext-n300);flex-shrink:0;' +
      'transition:background-color .4s;outline:none;' +
    '}' +
    '#ext-sidebar [data-testid="ext-memory-indicator"]:focus-visible{' +
      'box-shadow:0 0 0 2px var(--ext-accent);' +
    '}' +
    // Geometry + tooltip anchoring for the memory info icon. 2026-07-31: these four rules
    // used to be shared selectors also naming ext-rate-limit-info / ext-rate-limit-tooltip,
    // plus two rate-limit-only rules (a currentColor override and a 340px tooltip width).
    // Those selectors and rules went with the paused message — see BACKLOG.md. The memory
    // declarations below are unchanged.
    '#ext-sidebar [data-testid="ext-memory-info"]{' +
      'width:14px;height:14px;border-radius:50%;cursor:help;flex-shrink:0;' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'font-size:10px;font-weight:700;line-height:1;' +
      'background:var(--ext-n100);border:1px solid var(--ext-n200);color:var(--ext-n700);' +
      'outline:none;position:relative;' +
    '}' +
    '#ext-sidebar [data-testid="ext-memory-info"]:focus-visible{' +
      'box-shadow:0 0 0 2px var(--ext-accent);' +
    '}' +
    '#ext-sidebar [data-testid="ext-memory-tooltip"]{' +
      'display:none;position:absolute;top:32px;right:0;width:220px;' +
      'background:var(--ext-n900);color:var(--ext-bar-bg);font-size:11px;font-weight:400;' +
      'line-height:1.4;padding:8px 10px;border-radius:6px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:normal;' +
      'letter-spacing:normal;z-index:2147483647;' +
    '}' +
    '#ext-sidebar [data-testid="ext-memory-tooltip"].ext-tooltip-visible{' +
      'display:block;' +
    '}' +

    /* ── Dark theme overrides — explicit values override nightMode.js's !important rules ── */
    'html.ext-night #ext-sidebar{' +
      'background:#1c1f24 !important;' +
      'color:#e5edf5 !important;' +
      'border-bottom-color:rgba(255,255,255,.08) !important;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.4) !important;' +
    '}' +
    'html.ext-night #ext-sidebar [data-testid="ext-sidebar-title"]{color:#e5edf5 !important;}' +
    'html.ext-night #ext-sidebar [data-testid="ext-playpause"]{' +
      'background:#23272d !important;border-color:#2c313a !important;color:#b0bcca !important;' +
    '}' +
    'html.ext-night #ext-sidebar [data-testid="ext-playpause"]:hover{' +
      'background:#2c313a !important;border-color:#3a4250 !important;' +
    '}' +
    'html.ext-night #ext-sidebar[data-running="true"] [data-testid="ext-playpause"]{' +
      'background:#4c8dff !important;border-color:#4c8dff !important;color:#fff !important;' +
    '}' +
    'html.ext-night #ext-sidebar[data-running="true"] [data-testid="ext-playpause"]:hover{' +
      'background:#6ba1ff !important;border-color:#6ba1ff !important;' +
    '}' +
    'html.ext-night #ext-sidebar [data-testid="ext-slider-value"]{color:#b0bcca !important;}' +
    'html.ext-night #ext-sidebar [data-testid="ext-shared-rate-status"]{color:#9fb3c8 !important;}' +
    'html.ext-night #ext-sidebar [data-testid="ext-memory-indicator"]{border-color:#3a4250 !important;}' +
    'html.ext-night #ext-sidebar [data-testid="ext-memory-info"]{' +
      'background:#23272d !important;border-color:#2c313a !important;color:#b0bcca !important;' +
    '}' +
    'html.ext-night #ext-sidebar [data-testid="ext-memory-tooltip"]{' +
      'background:#e5edf5 !important;color:#1c1f24 !important;' +
    '}';
    // 2026-07-30: the old static 'body{padding-top:44px!important}' rule was removed —
    // body padding is now ALWAYS set via JS (syncBodyPadding()), both synchronously right
    // after the DOM is built (see below) and on every subsequent mode/backoff/interval
    // change, since the bar's height now varies. Keeping a stale static fallback here would
    // be redundant at best and confusing at worst (a maintainer could reasonably assume the
    // CSS rule is authoritative when JS always overrides it).

  document.head.appendChild(style);

  // Container
  const container = document.createElement('div');
  container.id = 'ext-sidebar';
  container.setAttribute('data-testid', 'ext-sidebar');
  container.setAttribute('data-running', 'false');
  // DRAGGABLE (2026-08-14). The bar itself is the handle — see makeSidebarDraggable() below.
  container.setAttribute('data-testid-drag', 'ext-sidebar-drag-handle');
  container.setAttribute('title', 'Drag to move — double-click to snap back to the top');

  // Title
  const title = document.createElement('span');
  title.setAttribute('data-testid', 'ext-sidebar-title');
  title.textContent = EXT_NAME;

  // Play/pause control — Click writes tabState; tabState subscriber drives the visual.
  const playpause = document.createElement('span');
  playpause.setAttribute('data-testid', 'ext-playpause');
  playpause.setAttribute('role', 'button');
  playpause.setAttribute('tabindex', '0');
  playpause.innerHTML =
    '<svg class="ext-pp__icon ext-pp__play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M8 5v14l11-7z"></path>' +
    '</svg>' +
    '<svg class="ext-pp__icon ext-pp__pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<rect x="6" y="5" width="4" height="14" rx="1"></rect>' +
      '<rect x="14" y="5" width="4" height="14" rx="1"></rect>' +
    '</svg>';

  // Speed slider — GLOBAL as of 2026-07-20 (was per-tab; see utils/tabState.js and
  // CHANGELOG.md — N independently-timed tabs multiplied the effective request rate
  // against one IP). title/aria-label make the new scope explicit in the UI, per the task
  // ("update the label so the user understands it applies browser-wide").
  const slider = document.createElement('input');
  slider.setAttribute('type', 'range');
  slider.setAttribute('data-testid', 'ext-slider-speed');
  slider.setAttribute('title', 'Refresh speed — applies to ALL open Relay tabs, not just this one');
  slider.setAttribute('aria-label', 'Refresh speed. Applies to all open Relay tabs.');
  slider.min   = '0.5';
  slider.max   = '8';
  slider.step  = '0.5';
  slider.value = '2';

  // Slider value display
  const sliderValue = document.createElement('span');
  sliderValue.setAttribute('data-testid', 'ext-slider-value');
  sliderValue.setAttribute('title', 'Applies to all open Relay tabs');
  sliderValue.textContent = '2.0s';

  // 2026-07-31: the rate-limit banner (ext-rate-limit-banner + ext-rate-limit-text +
  // ext-rate-limit-info + ext-rate-limit-tooltip) was built here and removed by PM decision.
  // Nothing about the paused state renders any more. The backoff/pause machinery it reported
  // on is untouched and still running — see background.js. Full record of what was here, for
  // reinstatement, in BACKLOG.md "Sidebar paused/rate-limit message".

  // Memory indicator — dispatcher-controlled reload, no auto-reload (see content.js).
  const memoryIndicator = document.createElement('span');
  memoryIndicator.setAttribute('data-testid', 'ext-memory-indicator');
  memoryIndicator.setAttribute('role', 'button');
  memoryIndicator.setAttribute('tabindex', '0');
  memoryIndicator.setAttribute('title', 'Memory usage — click to reload page');
  memoryIndicator.setAttribute('aria-label', 'Memory usage indicator. Click to reload the page.');

  // Info icon — hover/tap tooltip explaining the indicator
  const memoryInfo = document.createElement('span');
  memoryInfo.setAttribute('data-testid', 'ext-memory-info');
  memoryInfo.setAttribute('tabindex', '0');
  memoryInfo.setAttribute('aria-label', 'About the memory indicator');
  memoryInfo.textContent = 'i';

  const memoryTooltip = document.createElement('div');
  memoryTooltip.setAttribute('data-testid', 'ext-memory-tooltip');
  memoryTooltip.textContent =
    'Amazon Relay accumulates data in browser memory with each refresh. ' +
    'Reloading the page periodically frees that memory. Clicking the dot reloads ' +
    'the page now. You will need to re-enter your search filters afterward.';
  memoryInfo.appendChild(memoryTooltip);

  // Running scanline along the bottom edge
  const scanline = document.createElement('div');
  scanline.className = 'ext-scanline';
  scanline.innerHTML = '<div class="ext-scanline__seg"></div>';

  // Shared-rate status line (2026-07-30) — row 2, below the main controls row. Hidden by
  // default; shown only in shared mode ON and not during backoff — see
  // renderSharedRateStatus() below. N comes from background.js's own active-tab registry
  // (relayed via chrome.storage, see ACTIVE_TAB_COUNT_KEY), never counted independently here.
  const sharedRateStatus = document.createElement('div');
  sharedRateStatus.setAttribute('data-testid', 'ext-shared-rate-status');

  // Build DOM — row 1 (existing controls, now grouped so row 2 can sit below them)
  const row1 = document.createElement('div');
  row1.className = 'ext-sidebar-row1';
  row1.appendChild(title);
  row1.appendChild(playpause);
  row1.appendChild(slider);
  row1.appendChild(sliderValue);
  row1.appendChild(memoryIndicator);
  row1.appendChild(memoryInfo);
  container.appendChild(row1);
  container.appendChild(sharedRateStatus);
  container.appendChild(scanline);

  document.body.appendChild(container);
  // Synchronous fallback (row1-only height) so the page is never unpadded even for the
  // brief window before the async storage seed below resolves and calls the real
  // syncBodyPadding() with the actual mode/backoff state — replaces the old static CSS
  // rule. syncBodyPadding is a function declaration (hoisted), safe to call before its
  // later textual definition.
  syncBodyPadding(false);

  // --- Helpers ---

  function applyScanSpeed(speedSec) {
    var s   = parseFloat(speedSec);
    if (isNaN(s)) s = 2;
    var dur = s * 0.7;
    if (dur < 0.5) dur = 0.5;
    if (dur > 4)   dur = 4;
    container.style.setProperty('--ext-scan-dur', dur.toFixed(2) + 's');
  }

  // Visual + tooltip only. Does NOT write tabState. Called by tabState subscriber.
  function reflectRunning(running) {
    container.setAttribute('data-running', String(running));
    playpause.setAttribute('title',      running ? 'Searching — click to pause' : 'Paused — click to start');
    playpause.setAttribute('aria-label', running ? 'Monitoring is running. Click to pause.' : 'Monitoring is paused. Click to start.');
  }

  // User intent — writes tabState (single source of truth for this tab).
  // The 'running' subscriber fires reflectRunning synchronously; no direct call needed.
  // Starting (not stopping) re-checks the auth gate first — this sidebar only exists
  // because the gate was open at page load, but a tab can sit open for hours, long
  // enough for the session to need a refresh (or to have gone bad) since then. A
  // failed refresh here silently refuses to start; it never logs the dispatcher out
  // or touches Amazon's page. See utils/authGate.js.
  async function toggleRunning() {
    var nowRunning = !tabState.get('running');
    if (nowRunning) {
      var gate = await recheckAuthGate();
      if (!gate.active) {
        logger.warn('sidebar', 'toggleRunning: blocked — no active session');
        playpause.setAttribute('title', 'Sign in via the popup to activate Torren Relay — free.');
        setTimeout(function () {
          reflectRunning(tabState.get('running'));
        }, 3000);
        return;
      }
    }
    tabState.set('running', nowRunning);
    logger.log('sidebar', 'playpause toggled', { running: nowRunning });
  }

  // --- Memory indicator ---
  // Color stops (tune here): <=40% green, ~62.5% amber (midpoint), >=85% red.
  // Linear RGB interpolation between stops; polled independently of the orchestrator
  // loop (every MEMORY_POLL_MS) so it stays live even while monitoring is paused.
  var MEMORY_INDICATOR_LOW  = 0.40;
  var MEMORY_INDICATOR_MID  = 0.625;
  var MEMORY_INDICATOR_HIGH = 0.85;
  var MEMORY_POLL_MS        = 7000;
  var MEMORY_COLOR_GREEN = [46, 160, 67];   // #2ea043
  var MEMORY_COLOR_AMBER = [212, 167, 44];  // #d4a72c
  var MEMORY_COLOR_RED   = [218, 54, 51];   // #da3633
  var MEMORY_COLOR_NEUTRAL = '#8fa1b2'; // n400 — visible on both light and dark bar

  function lerpColor(c1, c2, t) {
    var r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    var g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    var b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function memoryColorForRatio(ratio) {
    if (ratio <= MEMORY_INDICATOR_LOW)  return 'rgb(' + MEMORY_COLOR_GREEN.join(',') + ')';
    if (ratio >= MEMORY_INDICATOR_HIGH) return 'rgb(' + MEMORY_COLOR_RED.join(',') + ')';
    if (ratio <= MEMORY_INDICATOR_MID) {
      var t1 = (ratio - MEMORY_INDICATOR_LOW) / (MEMORY_INDICATOR_MID - MEMORY_INDICATOR_LOW);
      return lerpColor(MEMORY_COLOR_GREEN, MEMORY_COLOR_AMBER, t1);
    }
    var t2 = (ratio - MEMORY_INDICATOR_MID) / (MEMORY_INDICATOR_HIGH - MEMORY_INDICATOR_MID);
    return lerpColor(MEMORY_COLOR_AMBER, MEMORY_COLOR_RED, t2);
  }

  function updateMemoryIndicator() {
    logger.debug('sidebar', 'updateMemoryIndicator called');
    var stats = (typeof getHeapUsageRatio === 'function') ? getHeapUsageRatio() : null;
    if (!stats) {
      memoryIndicator.style.backgroundColor = MEMORY_COLOR_NEUTRAL;
      memoryIndicator.setAttribute('title', 'Memory usage unavailable — click to reload page');
      return;
    }
    var pct = Math.round(stats.ratio * 100);
    memoryIndicator.style.backgroundColor = memoryColorForRatio(stats.ratio);
    memoryIndicator.setAttribute('title', 'Memory usage: ' + pct + '% — click to reload page');
    memoryIndicator.setAttribute('aria-label', 'Memory usage ' + pct + ' percent. Click to reload the page.');
  }

  // Dispatcher-initiated reload only — no automatic trigger exists anywhere in the
  // extension. This is our own UI element, not Amazon DOM, so SAFETY.md's
  // three-click-site rule does not govern it (documented there separately).
  function reloadForMemory() {
    logger.log('sidebar', 'memory indicator clicked — reloading page');
    location.reload();
  }

  function showMemoryTooltip() {
    memoryTooltip.classList.add('ext-tooltip-visible');
  }

  function hideMemoryTooltip() {
    memoryTooltip.classList.remove('ext-tooltip-visible');
  }

  // --- Global refresh interval + cross-tab rate-limit state (2026-07-20) ---
  // Local cache of background.js's rate-limiter state, kept in sync via
  // chrome.storage.onChanged below. Purely event-driven as of 2026-07-30 — the 1s tick
  // that used to redraw the countdown is gone along with the countdown itself.
  // rateLimited starts null (= "not read yet / field absent"), which is distinct from
  // false; isRateLimitPaused() relies on that distinction for its legacy fallback.
  var _rateLimitState = { backoffUntil: null, backoffStepIndex: -1, rateLimited: null };

  // Reads background.js's sticky `rateLimited` flag — deliberately NOT backoffUntil.
  // backoffUntil expiring only means "we may retry now"; the block is lifted only once a
  // request actually succeeds, which is exactly when background.js clears this flag. That
  // is what makes the paused state survive both a timer expiry and a page reload, and clear
  // on the first 2xx without any extra plumbing here. 2026-07-31: its only remaining reader
  // is renderSharedRateStatus() (row 2's visibility); it used to also drive the removed
  // paused message.
  //
  // Fallback: state written by a build predating the flag has no `rateLimited` field, so
  // fall back to the old timer test rather than showing nothing. Transient — background.js
  // writes the field on the very next reported result.
  function isRateLimitPaused() {
    if (typeof _rateLimitState.rateLimited === 'boolean') return _rateLimitState.rateLimited;
    return !!(_rateLimitState.backoffUntil && _rateLimitState.backoffUntil > Date.now());
  }

  // Single place that copies background.js's stored state into the local cache — used by
  // both the initial seed and the onChanged listener so the two can never drift.
  function adoptRateLimitState(rl) {
    var src = rl || {};
    _rateLimitState.backoffUntil     = src.backoffUntil || null;
    _rateLimitState.backoffStepIndex = (typeof src.backoffStepIndex === 'number') ? src.backoffStepIndex : -1;
    _rateLimitState.rateLimited      = (typeof src.rateLimited === 'boolean') ? src.rateLimited : null;
  }

  // "Shared rate" label + status line (2026-07-30) — _sharedLimitEnabled mirrors
  // STORAGE_KEYS.SHARED_LIMIT_ENABLED (true-default, same as popup.js/content.js's own
  // caches of it). _activeTabCount mirrors ACTIVE_TAB_COUNT_KEY, background.js's OWN
  // active-tab registry (see that file) — this is a read of the single source of truth,
  // not a second counter. Defaults to 1 so a fresh/unseeded sidebar shows a sane "1 active
  // tab" rather than "0 active tabs" before the first storage read resolves.
  var _sharedLimitEnabled = true;
  var _activeTabCount     = 1;

  // Bar height is two discrete states (row1 only, or row1+row2), not a measured
  // getBoundingClientRect() — avoids reflow-timing races and matches
  // #ext-sidebar-row1/[data-testid="ext-shared-rate-status"]'s CSS heights exactly.
  var SIDEBAR_ROW1_HEIGHT = 40;
  var SIDEBAR_ROW2_HEIGHT = 20;
  var SIDEBAR_GAP         = 4; // matches the original single-row 44px = 40 + 4

  function syncBodyPadding(showStatusRow) {
    var total = SIDEBAR_ROW1_HEIGHT + (showStatusRow ? SIDEBAR_ROW2_HEIGHT : 0) + SIDEBAR_GAP;
    document.body.style.setProperty('padding-top', total + 'px', 'important');
  }

  // MODE OFF: "Refresh every 2.0s" (per tab, unchanged meaning). MODE ON: "Shared rate: 1
  // refresh / 2.0s" (the slider now controls the GLOBAL budget, not this tab's own pace).
  function renderModeLabel() {
    var sec = parseFloat(slider.value);
    if (isNaN(sec)) sec = 2;
    sliderValue.textContent = _sharedLimitEnabled
      ? 'Shared rate: 1 refresh / ' + sec.toFixed(1) + 's'
      : 'Refresh every ' + sec.toFixed(1) + 's';
  }

  // Live "Active tabs: N -> each tab refreshes every X.Xs" line, X = interval * N — shown
  // only in shared mode ON and only when NOT paused. The original reason for the paused
  // condition was that the row-1 banner already explained the paused state, so this line
  // would have been redundant next to it; the banner is gone as of 2026-07-31 but the
  // condition is deliberately LEFT AS IS — this is a different element and the task was
  // scoped to the message only. Effect while paused: row 2 hides and the bar is 20px
  // shorter (syncBodyPadding keeps body padding in step, so no gap or overlap).
  function renderSharedRateStatus() {
    var show = _sharedLimitEnabled && !isRateLimitPaused();
    sharedRateStatus.style.display = show ? '' : 'none';
    if (show) {
      var sec = parseFloat(slider.value);
      if (isNaN(sec)) sec = 2;
      var n = (typeof _activeTabCount === 'number' && _activeTabCount >= 1) ? _activeTabCount : 1;
      var perTabSec = (sec * n).toFixed(1);
      sharedRateStatus.textContent = (n === 1)
        ? '1 active tab → refreshing every ' + perTabSec + 's'
        : 'Active tabs: ' + n + ' → each tab refreshes every ' + perTabSec + 's';
    }
    syncBodyPadding(show);
  }

  // Single entry point that re-renders everything derived from the rate-limiter state —
  // called from init and from the storage listener below. Kept under its existing name and
  // at its existing call sites; only its body shrank.
  //
  // 2026-07-31: used to also show the paused banner and hide slider+sliderValue behind it.
  // Banner removed by PM decision (message only — the backoff/pause machinery in
  // background.js is untouched). The slider swap went with it: it existed ONLY to make room
  // for the banner, so keeping it would have made the speed control silently vanish during a
  // pause with nothing left to explain why. Slider and its label now stay visible in every
  // state. Reinstating the banner means restoring this swap too — see BACKLOG.md.
  //
  // isRateLimitPaused() is still live and still consulted: renderSharedRateStatus() below
  // uses it to decide whether to show row 2. That behaviour is deliberately unchanged.
  function updateRateLimitDisplay() {
    renderModeLabel();
    renderSharedRateStatus();
  }

  // Seed visual state — GLOBAL settings now live in chrome.storage.local, not tabState
  // (moved 2026-07-20; see utils/tabState.js). Async, unlike the old synchronous
  // tabState.get() read — a brief flash of the '2.0s' default before this resolves is an
  // accepted, imperceptible trade-off (every other global setting in this codebase is
  // already seeded the same asynchronous way).
  chrome.storage.local.get(
    [STORAGE_KEYS.REFRESH_INTERVAL_MS, RATE_LIMITER_KEY, STORAGE_KEYS.SHARED_LIMIT_ENABLED, ACTIVE_TAB_COUNT_KEY],
    function (data) {
      var storedMs = data[STORAGE_KEYS.REFRESH_INTERVAL_MS];
      var initSpeedSec = (typeof storedMs === 'number' && storedMs > 0) ? storedMs / 1000 : 2;
      slider.value = String(initSpeedSec);
      applyScanSpeed(initSpeedSec);

      if (data[RATE_LIMITER_KEY]) adoptRateLimitState(data[RATE_LIMITER_KEY]);
      _sharedLimitEnabled = data[STORAGE_KEYS.SHARED_LIMIT_ENABLED] !== false; // true-default
      var atc = data[ACTIVE_TAB_COUNT_KEY];
      if (atc && typeof atc.count === 'number') _activeTabCount = atc.count;

      updateRateLimitDisplay();
    }
  );

  reflectRunning(tabState.get('running'));

  // Subscribe: orchestrator auto-stop flips the pill without a storage round-trip.
  // Named (not anonymous) and stashed on the container so content.js's
  // deactivateExtensionUI() can tabState.unsubscribe() it before removing the sidebar —
  // otherwise a later login's fresh buildSidebar() call would add a second permanent
  // subscriber referencing this (by-then detached) container, leaking one more on every
  // login/logout cycle.
  function handleRunningSync(val) {
    reflectRunning(val);
    logger.log('sidebar', 'running synced from tabState', { running: val });
  }
  tabState.subscribe('running', handleRunningSync);
  container._runningSubscriber = handleRunningSync;

  updateMemoryIndicator();
  // Independent of running state — also stashed on the container so it can be cleared on
  // deactivation (see comment above); otherwise it would keep polling forever, invisibly,
  // once removed from the DOM, and a reactivation would start a second one alongside it.
  container._memoryPollInterval = setInterval(updateMemoryIndicator, MEMORY_POLL_MS);

  // 2026-07-30: the 1s setInterval that redrew the countdown was REMOVED with the countdown.
  // Nothing needs a clock any more — every paused-state transition arrives as a
  // chrome.storage.onChanged event from background.js (see handleGlobalStorageChange below),
  // which is also the only thing that could ever change the answer now that visibility is
  // driven by the sticky `rateLimited` flag rather than by a timestamp going stale.
  // content.js's deactivateExtensionUI() no longer clears _rateLimitPollInterval either.

  // Cross-tab sync: the refresh-interval slider and the rate-limit state both reflect
  // GLOBAL chrome.storage.local state now, so a change made in ANY tab (a different
  // tab's slider, or background.js updating backoff) must be reflected here live. Named
  // (not anonymous) and stashed on the container for the same reason as
  // _runningSubscriber/_memoryPollInterval — deactivateExtensionUI() removes it before
  // the sidebar is torn down, so a later reactivation's fresh buildSidebar() doesn't
  // leak a second listener alongside it.
  function handleGlobalStorageChange(changes, area) {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.REFRESH_INTERVAL_MS] !== undefined) {
      var newMs = changes[STORAGE_KEYS.REFRESH_INTERVAL_MS].newValue;
      if (typeof newMs === 'number' && newMs > 0) {
        var sec = newMs / 1000;
        slider.value = String(sec);
        applyScanSpeed(sec);
        renderModeLabel();
        renderSharedRateStatus();
        logger.log('sidebar', 'refresh interval synced from another tab', { ms: newMs });
      }
    }
    // background.js writes this key on every reported result, so the paused state flips on
    // the first failure and clears on the first success, in every open tab, with no local
    // timer. 2026-07-31: this used to drive the paused message; with that removed, the only
    // remaining visible effect is row 2's visibility (see renderSharedRateStatus).
    if (changes[RATE_LIMITER_KEY] !== undefined) {
      adoptRateLimitState(changes[RATE_LIMITER_KEY].newValue);
      updateRateLimitDisplay();
    }
    // 2026-07-30: toggling "Shared refresh limit" in the popup must relabel the slider and
    // show/hide the status line immediately, in every open tab — no reload, same live-sync
    // mechanism as everything else in this listener.
    if (changes[STORAGE_KEYS.SHARED_LIMIT_ENABLED] !== undefined) {
      _sharedLimitEnabled = changes[STORAGE_KEYS.SHARED_LIMIT_ENABLED].newValue !== false;
      renderModeLabel();
      renderSharedRateStatus();
      logger.log('sidebar', 'sharedRefreshLimitEnabled synced from another tab', { value: _sharedLimitEnabled });
    }
    // N changed — a tab opened, closed, logged out, or paused elsewhere. background.js is
    // the sole source; this only re-renders from the value it already wrote.
    if (changes[ACTIVE_TAB_COUNT_KEY] !== undefined) {
      var newAtc = changes[ACTIVE_TAB_COUNT_KEY].newValue;
      if (newAtc && typeof newAtc.count === 'number') {
        _activeTabCount = newAtc.count;
        renderSharedRateStatus();
        logger.log('sidebar', 'activeTabCount synced', { count: _activeTabCount });
      }
    }
  }
  chrome.storage.onChanged.addListener(handleGlobalStorageChange);
  container._rateLimitStorageListener = handleGlobalStorageChange;

  // --- Event listeners ---
  // CLAUDE.md rule 2: addEventListener only, never inline handlers
  // CLAUDE.md rule 4: no .click() on Amazon elements — these only touch our own UI

  playpause.addEventListener('click', function () {
    toggleRunning();
  });

  playpause.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      toggleRunning();
    }
  });

  slider.addEventListener('input', function () {
    logger.log('sidebar', 'slider changed (GLOBAL — applies to all tabs)', { value: slider.value });
    var sec = parseFloat(slider.value);
    applyScanSpeed(sec);
    renderModeLabel();
    renderSharedRateStatus();
    chrome.storage.local.set({ [STORAGE_KEYS.REFRESH_INTERVAL_MS]: sec * 1000 });
  });

  // Click 4 — extension-owned UI, not Amazon DOM. Manual, dispatcher-initiated reload
  // only; no automatic trigger exists. See SAFETY.md.
  memoryIndicator.addEventListener('click', function () {
    reloadForMemory();
  });

  memoryIndicator.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      reloadForMemory();
    }
  });

  // Hover (desktop) and tap/focus (touch + keyboard) both reveal the tooltip.
  memoryInfo.addEventListener('mouseenter', showMemoryTooltip);
  memoryInfo.addEventListener('mouseleave', hideMemoryTooltip);
  memoryInfo.addEventListener('focus', showMemoryTooltip);
  memoryInfo.addEventListener('blur', hideMemoryTooltip);
  memoryInfo.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (memoryTooltip.classList.contains('ext-tooltip-visible')) {
      hideMemoryTooltip();
    } else {
      showMemoryTooltip();
    }
  });

  // 2026-07-31: the five ext-rate-limit-info tooltip listeners (mouseenter/mouseleave/
  // focus/blur/click) were removed with the element they were bound to. See BACKLOG.md.

  makeSidebarDraggable(container);

  logger.log('sidebar', 'sidebar injected');
}

// ── DRAGGABLE BAR (2026-08-14) ──────────────────────────────────────────────────────────────
//
// The bar is its own handle: press anywhere on it that is not a control and drag. Position
// persists across reloads; DOUBLE-CLICK snaps it back to the docked top position, so a
// dispatcher who drags it somewhere awkward is never stuck with it there.
//
// WHY A DRAG MUST NOT CLICK. The bar's controls are click-driven (play/pause, the city buttons
// in row 2). Without a movement threshold, the pointerup that ends a drag lands on whatever is
// under the cursor and fires it — dragging the bar by its "All" button would clear the filter.
// DRAG_SLOP_PX is the threshold: below it the gesture is a click and we never move anything;
// above it we suppress the click that follows, once.
var SIDEBAR_DRAG_SLOP_PX = 4;
var SIDEBAR_POS_KEY = 'extSidebarPos';

function makeSidebarDraggable(container) {
  logger.log('sidebar', 'makeSidebarDraggable called');
  try {
    var dragging = false, moved = false;
    var startX = 0, startY = 0, originLeft = 0, originTop = 0;

    // Applies a position, CLAMPED so the bar can never be dragged fully off-screen. At least
    // this much of it stays reachable on every edge.
    var EDGE_KEEP_PX = 40;
    function place(left, top) {
      var w = container.offsetWidth || 200;
      var h = container.offsetHeight || 40;
      var maxLeft = Math.max(0, window.innerWidth  - EDGE_KEEP_PX);
      var maxTop  = Math.max(0, window.innerHeight - EDGE_KEEP_PX);
      var l = Math.min(Math.max(left, EDGE_KEEP_PX - w), maxLeft);
      var t = Math.min(Math.max(top, 0), maxTop);   // never above the viewport top
      // Dragging switches the bar off its centred default; transform must go or it fights the
      // explicit left.
      container.style.left = l + 'px';
      container.style.top = t + 'px';
      container.style.transform = 'none';
      container.setAttribute('data-dragged', 'true');
      return { left: l, top: t };
    }

    // Back to the docked position: whatever the stylesheet says, with our overrides removed.
    function dock() {
      container.style.removeProperty('left');
      container.style.removeProperty('top');
      container.style.removeProperty('transform');
      container.removeAttribute('data-dragged');
      try { storage.set(SIDEBAR_POS_KEY, null); } catch (e) {
        logger.error('sidebar', 'clearing the stored bar position failed', { error: e });
      }
      logger.log('sidebar', 'bar re-docked to the top');
    }
    container._extDockSidebar = dock;

    container.addEventListener('pointerdown', function (ev) {
      // Left button only, and never when the press starts on something interactive — otherwise
      // a slider drag or a button press would move the bar instead.
      if (ev.button !== 0) return;
      var t = ev.target;
      if (t && t.closest && t.closest('input,button,select,textarea,[role="button"],[role="slider"]')) return;

      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      var r = container.getBoundingClientRect();
      originLeft = r.left;
      originTop = r.top;
    });

    // On window, not on the container: the pointer routinely leaves the bar mid-drag, and a
    // listener on the element alone would drop the gesture the moment it did.
    var onMove = function (ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < SIDEBAR_DRAG_SLOP_PX && Math.abs(dy) < SIDEBAR_DRAG_SLOP_PX) return;
      moved = true;
      place(originLeft + dx, originTop + dy);
    };

    var onUp = function () {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;                 // a plain click: let it through untouched
      var r = container.getBoundingClientRect();
      try { storage.set(SIDEBAR_POS_KEY, { left: r.left, top: r.top }); } catch (e) {
        logger.error('sidebar', 'storing the bar position failed', { error: e });
      }
      // Swallow exactly ONE click — the one this pointerup is about to produce — so ending a
      // drag over a button does not press it.
      var swallow = function (ce) {
        ce.stopPropagation();
        ce.preventDefault();
        window.removeEventListener('click', swallow, true);
      };
      window.addEventListener('click', swallow, true);
      // If no click follows (drag ended off any element), do not leave the trap armed.
      setTimeout(function () { window.removeEventListener('click', swallow, true); }, 0);
      logger.log('sidebar', 'bar moved', { left: Math.round(r.left), top: Math.round(r.top) });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    container._extDragMove = onMove;
    container._extDragUp = onUp;

    container.addEventListener('dblclick', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('input,button,select,textarea,[role="button"],[role="slider"]')) return;
      dock();
    });

    // Restore the stored position. Clamped on the way in as well as on the way out: the window
    // may be smaller than it was when the position was saved, and a bar restored off-screen
    // would be unreachable with no way to double-click it back.
    try {
      storage.get(SIDEBAR_POS_KEY, null).then(function (pos) {
        if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
        place(pos.left, pos.top);
        logger.log('sidebar', 'bar position restored', { left: Math.round(pos.left), top: Math.round(pos.top) });
      });
    } catch (e) {
      logger.error('sidebar', 'restoring the bar position failed — leaving it docked', { error: e });
    }
  } catch (e) {
    logger.error('sidebar', 'makeSidebarDraggable failed — the bar stays docked', { error: e });
  }
}
