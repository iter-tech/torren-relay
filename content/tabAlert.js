// content/tabAlert.js
// The wiring between this extension's own state and the tab indicator — it draws nothing itself.
//
// 🔑 THE INDICATOR IS `utils/tabIndicator.js`, WHICH IS THE SITE'S, COPIED (EXT-D4). This file only
// says WHEN each state applies:
//
//   the loop is running        -> searching   (the magnifier sweep)
//   new loads were found       -> alert       (the blinking disc + "(3) " on the title)
//   neither                    -> idle        (Amazon's own favicon, written back explicitly)
//
// 🔴 IT IS ALWAYS ON. NO SETTING GATES IT (EXT-D5, Ihor 2026-09-24).
//
// EXT-D4 shipped it behind the old "Tab Alert" checkbox, which defaults to OFF — so on a real
// install the indicator never started once: `tabAlertEnabled` stayed false, and the `running`
// subscriber and `flashTabAlert()` both returned on their first line. Ihor tested it live and saw
// nothing change. The site has no such switch and he asked for the site's behaviour, so the switch
// is gone rather than defaulted differently: the popup control, its storage write and its change
// listener were removed with it.
//
// 🔑 THE TRANSITIONS ARE THE SITE'S, read from `web/src/components/LoadsTable.tsx`:
//   - the alert WINS over searching while it is up (the indicator decides that, not this file);
//   - starting the loop CLEARS the alert — resuming is the acknowledgement, and leaving a count up
//     after the dispatcher has plainly seen it trains him to ignore the next one;
//   - an alert clears by itself after NEW_LOAD_ALERT_MS, the site's 60-second highlight window;
//   - leaving the page clears everything and hands Amazon its own icon and title back.
//
// ⚠ ONE TRANSITION IS OURS AND IS KEPT ON PURPOSE: returning to this tab clears the alert (U1,
// 2026-08-20 — "auto-stops the instant the dispatcher returns here"). The site has no such rule
// because nobody is ever "away" from a page they are looking at; here the whole point of the mark
// is a tab in the background, so seeing it is acknowledging it.
//
// U1's soft breathing dot, its two alphas of one hue, its title alternation and its 900 ms pulse
// are GONE — replaced by the site's three states so both tabs read the same. U1's real lesson is
// not gone: it is the reason `tabIndicator` writes an href for idle instead of removing our link.
//
// JS only, no clicks, no Amazon DOM changes beyond <head> icon links and document.title.

/** The site's NEW_HIGHLIGHT_MS (`components/BoardToolbar.tsx`): one batch, sixty seconds. */
var NEW_LOAD_ALERT_MS = 60000;

var tabAlertExpiry = null;

function clearTabAlertExpiry() {
  if (tabAlertExpiry === null) return;
  clearTimeout(tabAlertExpiry);
  tabAlertExpiry = null;
}

/** Drop the count, keep the sweep if the loop is still running. The site's `clearTabAlert()`. */
function stopTabAlert() {
  clearTabAlertExpiry();
  tabIndicator.setAlertCount(0);
}

/**
 * New loads found. `count` is what the title shows.
 * ⚠ THE LOOP HAS USUALLY JUST STOPPED ITSELF by the time this runs (content.js sets `running`
 * false on new loads), so the alert is what remains on the tab — which is the site's behaviour too.
 */
function startTabAlert(count) {
  tabIndicator.setAlertCount(count && count > 0 ? count : 1);
  // One batch, one window: a newer batch replaces the old one and restarts the clock, exactly as
  // the site's highlight does.
  clearTabAlertExpiry();
  tabAlertExpiry = setTimeout(function () {
    tabAlertExpiry = null;
    logger.log('tabAlert', 'alert window elapsed — clearing the count', { afterMs: NEW_LOAD_ALERT_MS });
    tabIndicator.setAlertCount(0);
  }, NEW_LOAD_ALERT_MS);
  logger.log('tabAlert', 'started', { count: count || 0 });
}

/**
 * Public entry — called by the orchestrator when new loads are found.
 * ⚠ IT DOES NOT SELF-GATE ON FOCUS. The indicator is a state, not a notification: with the tab in
 * front of him the count appears and the `focus`/`visibilitychange` handlers below clear it on his
 * next interaction with the window, which is the same outcome by a simpler route.
 */
async function flashTabAlert(count) {
  try {
    startTabAlert(count);
  } catch (e) {
    logger.warn('tabAlert', 'flashTabAlert failed', { error: e });
  }
}

// ── the searching state: the loop itself ─────────────────────────────────────────────────────────
// ⚠ THE SAME SUBSCRIBER THE REST OF THE EXTENSION USES (`tabState.subscribe('running')`), so the
// sweep starts and stops with the loop whatever started or stopped it — the sidebar's Play/Pause,
// an auto-stop on new loads, a logout, or the rate limiter.
tabState.subscribe('running', function (val) {
  if (val) {
    // 🔑 STARTING THE LOOP IS THE ACKNOWLEDGEMENT (the site's ring toggle).
    clearTabAlertExpiry();
    tabIndicator.setAlertCount(0);
  }
  tabIndicator.setSearching(val === true);
});

// Auto-stop the moment the dispatcher returns to this tab — U1's rule, kept.
window.addEventListener('focus', function () { stopTabAlert(); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') stopTabAlert();
});

// Leaving the page: Amazon's icon and title back, our link gone. The site's unmount rule.
window.addEventListener('pagehide', function () { tabIndicator.release(); });

/*
 * 🔑 ONE LINE AT CONTENT-SCRIPT START, VISIBLE IN A SHIPPED BUILD (Ihor 2026-09-24). EXT-D4 was
 * tested live and nothing happened, and the console could not answer the first question — is the
 * new code even loaded? This says so, with the version, before anything else can go wrong.
 *
 * ⚠ logger.notice, NOT logger.log: `log` needs DEBUG_LEVEL >= 3 and the shipped default is 1, which
 * is exactly how radiusUnitCaveat()'s warning ended up invisible in a shipped build
 * (utils/constants.js). `notice` is the level that survives it.
 *
 * ⚠ THE VERSION COMES FROM THE MANIFEST, never a literal (EXT-D1).
 */
(function () {
  var version = 'unknown';
  try {
    if (chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
      version = chrome.runtime.getManifest().version || 'unknown';
    }
  } catch (e) { /* the line is worth printing even without a version */ }
  logger.notice('tabIndicator', 'tab-indicator ready', {
    version: version,
    states: 'paused = Amazon favicon · searching = magnifier · new load = red disc + (n) title',
    gatedBy: 'nothing — always on (EXT-D5)'
  });
})();

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.flashTabAlert = function (n) { startTabAlert(n || 1); };
window.__EXT_DEBUG.stopTabAlert  = stopTabAlert;
window.__EXT_DEBUG.tabIndicator  = tabIndicator;
