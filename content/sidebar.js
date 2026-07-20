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
    '#ext-sidebar{' +
      'position:fixed;top:0;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;background:var(--ext-bar-bg);color:var(--ext-n900);' +
      'height:40px;padding:0 20px;display:flex;align-items:center;gap:12px;' +
      'border-radius:0 0 8px 8px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.14);' +
      'border-bottom:1px solid var(--ext-n200);' +
      'font-family:Arial,sans-serif;font-size:13px;font-weight:600;' +
      'letter-spacing:.3px;white-space:nowrap;user-select:none;overflow:hidden;' +
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
    '#ext-sidebar [data-testid="ext-memory-indicator"]{' +
      'width:12px;height:12px;border-radius:50%;cursor:pointer;' +
      'border:1px solid var(--ext-n300);flex-shrink:0;' +
      'transition:background-color .4s;outline:none;' +
    '}' +
    '#ext-sidebar [data-testid="ext-memory-indicator"]:focus-visible{' +
      'box-shadow:0 0 0 2px var(--ext-accent);' +
    '}' +
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
    'html.ext-night #ext-sidebar [data-testid="ext-memory-indicator"]{border-color:#3a4250 !important;}' +
    'html.ext-night #ext-sidebar [data-testid="ext-memory-info"]{' +
      'background:#23272d !important;border-color:#2c313a !important;color:#b0bcca !important;' +
    '}' +
    'html.ext-night #ext-sidebar [data-testid="ext-memory-tooltip"]{' +
      'background:#e5edf5 !important;color:#1c1f24 !important;' +
    '}' +

    'body{padding-top:44px!important;}';

  document.head.appendChild(style);

  // Container
  const container = document.createElement('div');
  container.id = 'ext-sidebar';
  container.setAttribute('data-testid', 'ext-sidebar');
  container.setAttribute('data-running', 'false');

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

  // Speed slider
  const slider = document.createElement('input');
  slider.setAttribute('type', 'range');
  slider.setAttribute('data-testid', 'ext-slider-speed');
  slider.min   = '0.5';
  slider.max   = '8';
  slider.step  = '0.5';
  slider.value = '2';

  // Slider value display
  const sliderValue = document.createElement('span');
  sliderValue.setAttribute('data-testid', 'ext-slider-value');
  sliderValue.textContent = '2.0s';

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

  // Build DOM
  container.appendChild(title);
  container.appendChild(playpause);
  container.appendChild(slider);
  container.appendChild(sliderValue);
  container.appendChild(memoryIndicator);
  container.appendChild(memoryInfo);
  container.appendChild(scanline);

  document.body.appendChild(container);

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

  // Seed visual state from tabState (synchronous — tabState.init() completed before buildSidebar)
  var initSpeedSec = tabState.get('refreshIntervalMs') / 1000;
  slider.value = String(initSpeedSec);
  sliderValue.textContent = initSpeedSec.toFixed(1) + 's';
  applyScanSpeed(initSpeedSec);

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
    logger.log('sidebar', 'slider changed', { value: slider.value });
    var sec = parseFloat(slider.value);
    sliderValue.textContent = sec.toFixed(1) + 's';
    applyScanSpeed(sec);
    tabState.set('refreshIntervalMs', sec * 1000);
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

  logger.log('sidebar', 'sidebar injected');
}
