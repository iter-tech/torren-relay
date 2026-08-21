// content/tabAlert.js
// "Tab Alert" — when a new load is found and this tab is NOT focused, mark the tab so the
// dispatcher notices it without being startled: the title alternates with a bulleted count and
// the favicon breathes between two ALPHAS OF ONE HUE (a soft accent dot). Auto-stops the instant
// the dispatcher returns here, RESTORING the page's own title and favicon.
//
// NOTE: a page cannot recolor the real tab strip — that is Chrome UI. The favicon is the only
// surface available, so the indicator lives there.
//
// U1 (2026-08-20) rewrote the appearance and fixed a real defect. Before: solid RED alternating
// with solid YELLOW, two hardcoded literals, a 600ms strobe, a red-circle emoji in the title, and
// stopping only REMOVED our <link> — which does not bring the page's icon back. See
// extRestoreOriginalFavicon().
//
// JS only, no clicks, no Amazon DOM changes. Single interval, cleared on stop —
// nothing accumulates in memory. Reads STORAGE_KEYS.TAB_ALERT.

var TAB_ALERT_LINK_ID = 'ext-tab-alert-favicon';
var tabAlertTimer     = null;
var tabAlertPhase     = 0;
var tabAlertOrigTitle = null;
// U1 (2026-08-20): the indicator was a solid RED block alternating with solid YELLOW —
// alarming, and two hardcoded literals. It is now a soft accent DOT that breathes between two
// alphas of the SAME hue: present enough to catch the eye in a tab strip, quiet enough not to
// read as an emergency. Ihor's reference is Apple's visual language.
var EXT_ICON_DOT_SOFT   = null;
var EXT_ICON_DOT_STRONG = null;
// The favicon the page had before we touched it. Captured at start and RESTORED on stop —
// see extRestoreOriginalFavicon() for why removing our <link> is not enough.
var tabAlertOrigIconHref = null;
var tabAlertOrigIconEl   = null;

// Resolves an --ext-* token to a concrete colour. Canvas needs a real value, so the token is
// READ at runtime rather than a literal being written here — that keeps the "tokens only, no
// new literals" rule while still being paintable. If the token cannot be resolved (design
// tokens not loaded yet), it returns null and the caller skips the favicon rather than
// inventing a colour.
function extToken(name) {
  logger.log('tabAlert', 'extToken called', { name: name });
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = (v || '').trim();
    return v.length ? v : null;
  } catch (e) {
    logger.error('tabAlert', 'extToken failed — the favicon will be left alone rather than ' +
      'painted with an invented colour', { error: e, name: name });
    return null;
  }
}

// A soft filled dot, centred, at the given alpha. Not a full-bleed block: a 32px square of
// saturated colour is what made the old indicator shout.
function extMakeDotIcon(color, alpha) {
  logger.log('tabAlert', 'extMakeDotIcon called', { alpha: alpha });
  try {
    if (!color) return null;
    var c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 32, 32);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(16, 16, 9, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png');
  } catch (e) {
    logger.error('tabAlert', 'extMakeDotIcon failed — no favicon change', { error: e });
    return null;
  }
}

function extEnsureAlertFavicon(href) {
  var link = document.getElementById(TAB_ALERT_LINK_ID);
  if (!link) {
    link = document.createElement('link');
    link.id  = TAB_ALERT_LINK_ID;
    link.rel = 'icon';
  }
  link.href = href;
  document.head.appendChild(link); // keep ours last so the browser uses it
}

// ⚠ THE DEFECT U1 FIXES. Removing our <link> does NOT reliably bring the page's own favicon
// back: browsers do not re-read the remaining icon links just because one was detached, so the
// tab kept showing our block after the alert had "stopped". The indicator stopped ANIMATING
// but never DISAPPEARED.
//
// The fix is to hand the browser the original href explicitly before letting go of the element,
// which forces a re-read, and only then remove ours.
function extRestoreOriginalFavicon() {
  logger.log('tabAlert', 'extRestoreOriginalFavicon called');
  try {
    var link = document.getElementById(TAB_ALERT_LINK_ID);
    if (link) {
      if (tabAlertOrigIconHref) {
        // Point our own link back at the page's icon first — the browser repaints the tab from
        // it — then drop the element.
        link.href = tabAlertOrigIconHref;
      }
      link.remove();
    }
    // Re-assert the page's own <link> so it is unambiguously the last icon declared.
    if (tabAlertOrigIconEl && tabAlertOrigIconEl.parentNode) {
      var href = tabAlertOrigIconEl.href;
      tabAlertOrigIconEl.parentNode.appendChild(tabAlertOrigIconEl);
      tabAlertOrigIconEl.href = href;
    }
    tabAlertOrigIconHref = null;
    tabAlertOrigIconEl   = null;
  } catch (e) {
    logger.error('tabAlert', 'extRestoreOriginalFavicon failed — the tab may keep our icon ' +
      'until the next navigation', { error: e });
  }
}

// Captures the page's own icon once, before we replace it.
function extCaptureOriginalFavicon() {
  logger.log('tabAlert', 'extCaptureOriginalFavicon called');
  try {
    if (tabAlertOrigIconEl) return;
    var links = document.querySelectorAll('link[rel~="icon"]');
    for (var i = links.length - 1; i >= 0; i--) {
      if (links[i].id === TAB_ALERT_LINK_ID) continue;
      tabAlertOrigIconEl   = links[i];
      tabAlertOrigIconHref = links[i].href;
      return;
    }
  } catch (e) {
    logger.error('tabAlert', 'extCaptureOriginalFavicon failed — restore will fall back to ' +
      'removing our link only', { error: e });
  }
}

function stopTabAlert() {
  if (tabAlertTimer !== null) {
    clearInterval(tabAlertTimer);
    tabAlertTimer = null;
  }
  if (tabAlertOrigTitle !== null) {
    document.title = tabAlertOrigTitle;
    tabAlertOrigTitle = null;
  }
  extRestoreOriginalFavicon();   // U1: RESTORE, not merely remove — see that function
  tabAlertPhase = 0;
}

function startTabAlert(count) {
  if (tabAlertTimer !== null) return; // already blinking
  // U1: one hue, two alphas — a breath rather than a strobe. The colour comes from the
  // --ext-accent token, read at runtime; --ext-n700 is the fallback, also a token. If neither
  // resolves, the icons stay null and only the title alternates.
  if (EXT_ICON_DOT_SOFT === null) {
    var dotColor = extToken('--ext-accent') || extToken('--ext-n700');
    EXT_ICON_DOT_SOFT   = extMakeDotIcon(dotColor, 0.35);
    EXT_ICON_DOT_STRONG = extMakeDotIcon(dotColor, 0.90);
  }
  extCaptureOriginalFavicon();

  tabAlertOrigTitle = document.title;
  // U1: the red-circle emoji read as an alarm. A small neutral bullet marks the tab without
  // shouting, and the count carries the actual information.
  var label = (count && count > 1)
    ? ('\u2022 ' + count + ' new loads')
    : '\u2022 New load';

  tabAlertTimer = setInterval(function () {
    tabAlertPhase = tabAlertPhase ? 0 : 1;
    if (tabAlertPhase) {
      document.title = label;
      if (EXT_ICON_DOT_STRONG) extEnsureAlertFavicon(EXT_ICON_DOT_STRONG);
    } else {
      document.title = tabAlertOrigTitle;
      if (EXT_ICON_DOT_SOFT) extEnsureAlertFavicon(EXT_ICON_DOT_SOFT);
    }
  // U1: 900ms, not 600 — slow enough to read as a pulse rather than a flash.
  }, 900);

  logger.log('tabAlert', 'started', { count: count || 0 });
}

// Public entry — called by the orchestrator when new loads are found.
// Self-gates on the setting and only blinks when this tab is NOT focused.
async function flashTabAlert(count) {
  try {
    var on = await storage.get(STORAGE_KEYS.TAB_ALERT, false);
    if (on !== true) return;
    var focused = document.hasFocus() && document.visibilityState === 'visible';
    if (focused) return;
    startTabAlert(count);
  } catch (e) {
    logger.warn('tabAlert', 'flashTabAlert failed', { error: e });
  }
}

// Auto-stop the moment the dispatcher returns to this tab.
window.addEventListener('focus', function () { stopTabAlert(); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') stopTabAlert();
});

// If the feature is switched OFF while blinking, stop immediately.
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (!changes[STORAGE_KEYS.TAB_ALERT]) return;
  if (changes[STORAGE_KEYS.TAB_ALERT].newValue !== true) stopTabAlert();
});

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.flashTabAlert = function (n) { startTabAlert(n || 1); };
window.__EXT_DEBUG.stopTabAlert  = stopTabAlert;
